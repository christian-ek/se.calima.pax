'use strict';

import Homey, {
  BleAdvertisement, BlePeripheral,
} from 'homey';
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
  private isSyncing: boolean = false; // Flag to track ongoing sync operations

  async onInit(): Promise<void> {
    this.registerCapabilityListeners();
    this.onSyncInterval = setInterval(() => this.onSync(), PaxDevice.SYNC_INTERVAL);
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

    this.isSyncing = true;
    const { firstRun, mode } = this.getStore();

    if (firstRun) await this.firstRun(mode);

    let api: PaxApi | undefined;
    try {
      api = await this.connectToDevice();
      await this.updateDeviceState(api, mode);
    } catch (error) {
      if (error instanceof Error) {
        this.error(`Error during onSync operation: ${error.message}`);
      } else {
        this.error(`Error during onSync operation: ${String(error)}`);
      }
    } finally {
      if (api) {
        await api.disconnect();
      }
      this.isSyncing = false;
    }
  }

  private async updateDeviceState(api: PaxApi, mode: string): Promise<void> {
    try {
      const fanState = await api.getStatus();
      const fanSpeed = await api.getFanSpeed();
      this.log(`Fan state: ${fanState.toString()}`);
      this.log(`Fanspeed: ${fanSpeed.toString()}`);

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
        this.log(`BoostMode: ${boostMode.toString()}`);
        await this.setCapabilityValue('boost', boostMode.OnOff);
      }
    } catch (error) {
      if (error instanceof Error) {
        this.error(`Error updating device state: ${error.message}`);
      } else {
        this.error(`Error updating device state: ${String(error)}`);
      }
    }
  }

  private async connectToDevice(): Promise<PaxApi> {
    const { id, pin } = this.getData();
    if (!this.advertisement) {
      this.advertisement = await this.homey.ble.find(id);
    }

    try {
      const peripheral: BlePeripheral = await this.advertisement.connect();
      await peripheral.assertConnected();
      return new PaxApi(pin, peripheral, this.homey);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to connect to device: ${error.message}`);
      } else {
        throw new Error(`Failed to connect to device: ${String(error)}`);
      }
    }
  }

  async onCapabilitySetFanSpeed(speed: number, capability: 'trickle' | 'humidity' | 'light'): Promise<void> {
    let api: PaxApi | undefined;
    try {
      api = await this.connectToDevice();
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
      if (error instanceof Error) {
        this.error(`Error setting fan speed for ${capability}: ${error.message}`);
      } else {
        this.error(`Error setting fan speed for ${capability}: ${String(error)}`);
      }
    } finally {
      if (api) {
        await api.disconnect();
      }
    }
  }

  async boostOnOff(options: BoostOptions): Promise<void> {
    let api: PaxApi | undefined;
    try {
      api = await this.connectToDevice();
      let func: Promise<void>;
      if (options.on) {
        func = api.startBoost(options.duration || PaxDevice.DEFAULT_BOOST_DURATION);
      } else {
        func = api.stopBoost();
      }
      await func;
    } catch (error) {
      if (error instanceof Error) {
        this.error(`Error changing boost mode: ${error.message}`);
      } else {
        this.error(`Error changing boost mode: ${String(error)}`);
      }
    } finally {
      if (api) {
        await api.disconnect();
      }
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
