'use strict';

import Homey, {
  BleAdvertisement, BlePeripheral,
} from 'homey';
import PaxApi from '../../lib/api';

interface BoostOptions {
  on: boolean;
  duration?: number;
}

class PaxDevice extends Homey.Device {
  private static SYNC_INTERVAL: number = 1000 * 30; // 30 seconds
  private static DEFAULT_BOOST_DURATION: number = 900;

  private advertisement?: BleAdvertisement;
  private peripheral?: BlePeripheral;
  private onSyncInterval?: ReturnType<typeof setTimeout>;
  private api?: PaxApi;

  async onInit(): Promise<void> {
    this.registerCapabilityListeners();

    this.onSyncInterval = setInterval(() => this.onSync(), PaxDevice.SYNC_INTERVAL);
  }

  private registerCapabilityListeners(): void {
    const { mode } = this.getStore();
    this.registerCapabilityListener('fanspeed.trickle', (speed: number) => this.onCapabilitySetFanSpeed(speed, 'trickle'));
    this.registerCapabilityListener('fanspeed.humidity', (speed: number) => this.onCapabilitySetFanSpeed(speed, 'humidity'));
    this.registerCapabilityListener('fanspeed.light', (speed: number) => this.onCapabilitySetFanSpeed(speed, 'light'));

    if (mode !== 'HeatDistributionMode') {
      this.registerCapabilityListener('boost', (value: boolean, options: { duration?: number }) =>
        this.boostOnOff({
          on: value,
          duration: typeof options.duration === 'number' && options.duration % 25 === 0 ? options.duration : PaxDevice.DEFAULT_BOOST_DURATION,
        }),
      );
    }
  }

  private async disconnect(): Promise<void> {
    if (this.peripheral) {
      await this.peripheral.disconnect();
      this.api = undefined;
    }
  }

  async onSync(): Promise<void> {
    const { firstRun, mode } = this.getStore();

    // Check if this is the first run and handle accordingly
    if (firstRun) this.firstRun(mode);

    try {
      await this.connectToDevice();
      await this.updateDeviceState(mode);
      this.disconnect();
    } catch (error) {
      this.homey.error(`Error during onSync operation: ${error}`);
    }
  }

  private async updateDeviceState(mode: string): Promise<void> {
    if (!this.api) throw new Error('Failed to connect to device');
    const fanState = await this.api.getStatus();
    this.homey.log(`[${this.getName()}]`, fanState.toString());

    await Promise.all([
      this.setCapabilityValue('measure_temperature', fanState.Temp),
      this.setCapabilityValue('measure_humidity', fanState.Humidity),
      this.setCapabilityValue('measure_luminance', fanState.Light),
      this.setCapabilityValue('measure_rpm', fanState.RPM),
      this.setCapabilityValue('mode', fanState.Mode),
    ]).catch((error) => this.homey.error(`Error updating capabilities: ${error}`));

    // Check and update boost mode status if applicable
    if (mode !== 'HeatDistributionMode') {
      const boostMode = await this.api.getBoostMode();
      this.homey.log(`[${this.getName()}]`, boostMode.toString());
      await this.setCapabilityValue('boost', boostMode.OnOff).catch((error) => this.homey.error(`Error updating boost mode: ${error}`));
    }

    // Get and update fan speed status
    const fanSpeed = await this.api.getFanSpeed();
    this.homey.log(`[${this.getName()}]`, fanSpeed.toString());
    await Promise.all([
      this.setCapabilityValue('fanspeed.trickle', fanSpeed.Trickle),
      this.setCapabilityValue('fanspeed.humidity', fanSpeed.Humidity),
      this.setCapabilityValue('fanspeed.light', fanSpeed.Light),
    ]).catch((error) => this.homey.error(`Error updating fan speeds: ${error}`));
  }

  private async connectToDevice(): Promise<void> {
    const { id, pin } = this.getData();
    if (!this.advertisement) {
      this.advertisement = await this.homey.ble.find(id);
    }

    this.peripheral = await this.advertisement.connect();
    await this.peripheral.assertConnected();
    this.api = new PaxApi(pin, this.peripheral, this.homey);
  }

  async onCapabilitySetFanSpeed(speed: number, capability: 'trickle' | 'humidity' | 'light'): Promise<void> {
    try {
      await this.connectToDevice();
      if (!this.api) throw new Error('Failed to connect to device');
      const currentSpeeds = await this.api.getFanSpeed();
      await this.setCapabilityValue(`fanspeed.${capability}`, speed);

      switch (capability) {
        case 'trickle':
          await this.api.setFanSpeed(currentSpeeds.Humidity, currentSpeeds.Light, speed);
          break;
        case 'humidity':
          await this.api.setFanSpeed(speed, currentSpeeds.Light, currentSpeeds.Trickle);
          break;
        case 'light':
          await this.api.setFanSpeed(currentSpeeds.Humidity, speed, currentSpeeds.Trickle);
          break;
        default:
          this.homey.error('Unrecognized capability');
      }
      this.homey.log(`[${this.getName()}]`, `Fanspeed (${capability}) set to ${speed} RPM`);
      this.disconnect();
    } catch (err) {
      this.homey.error(err);
    }
  }

  async boostOnOff(options: BoostOptions): Promise<void> {
    try {
      await this.connectToDevice();
      if (!this.api) throw new Error('Failed to connect to device');
      let func: Promise<void>;
      if (options.on) {
        func = this.api.startBoost(options.duration || PaxDevice.DEFAULT_BOOST_DURATION);
      } else {
        func = this.api.stopBoost();
      }
      await func;
      this.disconnect();
    } catch (err) {
      this.homey.error(`Error changing boost mode: ${err}`);
    }
  }

  async firstRun(mode: string): Promise<void> {
    if (mode === 'HeatDistributionMode') {
      this.homey.log('Removing boost capability for Heat Distribution Mode fan.');
      await this.removeCapability('boost');
      await this.setStoreValue('firstRun', false);
    }
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.homey.log('PAX Calima device has been added');
    this.printInfo();
  }

  printInfo() {
    this.homey.log('name:', this.getName());
    this.homey.log('class:', this.getClass());
    this.homey.log('data', this.getData());
    this.homey.log('store', this.getStore());
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log(`${name} device was renamed`);
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  onDeleted() {
    const { onSyncInterval } = this;

    clearInterval(onSyncInterval); // Clear the onSync interval to stop further execution

    this.homey.log('PAX Calima device has been deleted');
  }

}

module.exports = PaxDevice;
