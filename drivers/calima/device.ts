'use strict';

import Homey, { BleAdvertisement, BlePeripheral } from 'homey';
import PaxApi from '../../lib/api';
import FanMode from '../../lib/FanMode';

interface BoostOptions {
  on: boolean;
  duration?: number;
}

class PaxDevice extends Homey.Device {
  private static SYNC_INTERVAL: number = 1000 * 30; // 30 seconds
  private static DEFAULT_BOOST_DURATION: number = 900;

  private advertisement?: BleAdvertisement;
  private onSyncInterval?: ReturnType<typeof setTimeout>;
  private isSyncing: boolean = false;

  async onInit(): Promise<void> {
    this.registerCapabilityListeners();
    this.onSyncInterval = setInterval(() => this.onSync(), PaxDevice.SYNC_INTERVAL);
    this.onSync();
  }

  private registerCapabilityListeners(): void {
    const { mode } = this.getStore();
    this.registerCapabilityListener('fanspeed.trickle', (speed: number) => this.onCapabilitySetFanSpeed(speed, 'trickle'));
    this.registerCapabilityListener('fanspeed.humidity', (speed: number) => this.onCapabilitySetFanSpeed(speed, 'humidity'));
    this.registerCapabilityListener('fanspeed.light', (speed: number) => this.onCapabilitySetFanSpeed(speed, 'light'));

    if (!FanMode.isHeatDistributionMode(mode)) {
      this.registerCapabilityListener('boost', (value: boolean, options: { duration?: number }) =>
        this.boostOnOff({
          on: value,
          duration: typeof options.duration === 'number' && options.duration % 25 === 0 ? options.duration : PaxDevice.DEFAULT_BOOST_DURATION,
        }),
      );
    }
  }

  async onSync(): Promise<void> {
    if (this.isSyncing) {
      this.log('Sync operation already in progress, skipping this interval.');
      return;
    }
    this.log('Starting sync operation...');

    this.isSyncing = true;
    const { firstRun, mode } = this.getStore();

    if (firstRun) await this.firstRun(mode);

    let api: PaxApi | undefined;
    try {
      api = await this.connectToDevice();
      if (!api) {
        this.error('Failed to connect to the device, will retry at next interval.');
        return;
      }
      await this.updateDeviceState(api, mode);
      this.log('Sync operation completed successfully.');
    } catch (error) {
      this.error(`Error during onSync operation: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.disconnectFromDevice(api);
      this.isSyncing = false;
    }
  }

  private async updateDeviceState(api: PaxApi, mode: string): Promise<void> {
    const fanState = await api.getStatus();
    const fanSpeed = await api.getFanSpeed();
    this.log(fanState.toString());
    this.log(fanSpeed.toString());

    await Promise.all([
      this.setCapabilityValue('measure_temperature', fanState.Temp),
      this.setCapabilityValue('measure_humidity', fanState.Humidity),
      this.setCapabilityValue('measure_luminance', fanState.Light),
      this.setCapabilityValue('measure_rpm', fanState.RPM),
      this.setCapabilityValue('mode', fanState.Mode),
      this.setCapabilityValue('fanspeed.trickle', fanSpeed.Trickle),
      this.setCapabilityValue('fanspeed.humidity', fanSpeed.Humidity),
      this.setCapabilityValue('fanspeed.light', fanSpeed.Light),
    ]);

    if (!FanMode.isHeatDistributionMode(mode)) {
      const boostMode = await api.getBoostMode();
      this.log(boostMode.toString());
      await this.setCapabilityValue('boost', boostMode.OnOff);
    }
  }

  private async findAdvertisement(): Promise<BleAdvertisement | undefined> {
    const { id } = this.getData();
    try {
      return await this.homey.ble.find(id);
    } catch (error) {
      this.error(`Failed to find device advertisement: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private async connectToDevice(): Promise<PaxApi | undefined> {
    if (!this.advertisement) {
      this.advertisement = await this.findAdvertisement();
      if (!this.advertisement) {
        this.error('Device advertisement not found');
        return undefined;
      }
      this.log('Device advertisement found');
    }

    try {
      this.log('Connecting to the device...');
      const peripheral: BlePeripheral = await this.advertisement.connect();
      await peripheral.assertConnected();
      this.log('Peripheral connected');
      const { pin } = this.getData();
      return new PaxApi(pin, peripheral, this.homey);
    } catch (error) {
      this.error(`Failed to connect to device: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private disconnectFromDevice(api: PaxApi | undefined): void {
    if (!api) return;
    try {
      this.log('Disconnecting from the device...');
      api.disconnect();
    } catch (error) {
      this.error(`Error disconnecting from the device: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async onCapabilitySetFanSpeed(speed: number, capability: 'trickle' | 'humidity' | 'light'): Promise<void> {
    let api: PaxApi | undefined;
    try {
      api = await this.connectToDevice();
      if (!api) {
        this.error('Failed to connect to the device');
        return;
      }

      const currentSpeeds = await api.getFanSpeed();
      await this.setCapabilityValue(`fanspeed.${capability}`, speed);

      switch (capability) {
        case 'trickle':
          await api.setFanSpeed(currentSpeeds.Humidity, currentSpeeds.Light, speed);
          break;
        case 'humidity':
          await api.setFanSpeed(speed, currentSpeeds.Light, currentSpeeds.Trickle);
          break;
        case 'light':
          await api.setFanSpeed(currentSpeeds.Humidity, speed, currentSpeeds.Trickle);
          break;
        default:
          this.error(`Unrecognized capability: ${capability}`);
      }
      this.log(`Fanspeed (${capability}) set to ${speed} RPM`);
    } catch (error) {
      this.error(`Error setting fan speed for ${capability}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      this.disconnectFromDevice(api);
    }
  }

  async boostOnOff(options: BoostOptions): Promise<void> {
    let api: PaxApi | undefined;
    try {
      api = await this.connectToDevice();
      if (!api) {
        this.error('Failed to connect to the device');
        return;
      }

      let func: Promise<void>;
      if (options.on) {
        func = api.startBoost(options.duration || PaxDevice.DEFAULT_BOOST_DURATION);
      } else {
        func = api.stopBoost();
      }
      await func;
    } catch (error) {
      this.error(`Error changing boost mode: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      this.disconnectFromDevice(api);
    }
  }

  async firstRun(mode: string): Promise<void> {
    if (FanMode.isHeatDistributionMode(mode)) {
      this.log('Removing boost capability for Heat Distribution Mode fan.');
      await this.removeCapability('boost');
      await this.setStoreValue('firstRun', false);
    }
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('Device has been added');
    this.printInfo();
  }

  printInfo() {
    this.log('name:', this.getName());
    this.log('class:', this.getClass());
    this.log('data', this.getData());
    this.log('store', this.getStore());
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log(`Device was renamed to ${name}`);
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  onDeleted() {
    const { onSyncInterval } = this;
    clearInterval(onSyncInterval); // Clear the onSync interval to stop further execution
    this.log('Device has been deleted');
  }

  public log(message: string, ...args: any[]) {
    this.homey.log(`[${this.getName()}] ${message}`, ...args);
  }

  public error(message: string, ...args: any[]) {
    this.homey.error(`[${this.getName()}] ${message}`, ...args);
  }
}

module.exports = PaxDevice;
