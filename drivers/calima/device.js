'use strict';

const Homey = require('homey');
const PaxApi = require('../../lib/api');

class PaxCalimaDevice extends Homey.Device {

  static SYNC_INTERVAL = 1000 * 30; // 30 seconds
  static DEFAULT_BOOST_DURATION = 900;
  static BLE_SEARCH_TIMEOUT = 30;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    const { mode } = this.getStore();
    this._device = null;
    this._peripheral = null;
    this.onSyncInterval = null; // Store the setInterval object
    this.isDeleted = false;

    this.setUnavailable('Unable to connect to PAX Calima').catch((error) => this.homey.error(error));

    if (mode !== 'HeatDistributionMode') {
      this.registerCapabilityListener('boost', async (value, options) => {
        this.boostOnOff({
          on: value,
          duration: typeof options.duration === 'number' && options.duration % 25 === 0
            ? options.duration
            : this.constructor.DEFAULT_BOOST_DURATION,
        });
      });
    }

    this.registerCapabilityListener('fanspeed.trickle', (speed) => this.onCapabilitySetFanSpeed(speed, 'trickle'));
    this.registerCapabilityListener('fanspeed.humidity', (speed) => this.onCapabilitySetFanSpeed(speed, 'humidity'));
    this.registerCapabilityListener('fanspeed.light', (speed) => this.onCapabilitySetFanSpeed(speed, 'light'));

    this.find().then(this._onDeviceInit.bind(this));
  }

  async findLoop() {
    return new Promise((resolve) => {
      this.log('Trying to find again in', this.delay ? '30s' : '10s');
      setTimeout(async () => {
        this.delay = true;
        await this.find();
        resolve();
      }, this.delay ? 30000 : 10000);
    });
  }

  async find() {
    try {
      const { id } = this.getData();
      this._device = await this.homey.ble.find(id);

      return Promise.resolve(true);
    } catch (error) {
      this.error(error);
      return this.findLoop();
    }
  }

  async connectToDevice() {
    const { pin } = this.getData();
    let isConnected = false;
    let useDelay = false;
    let attempt = 1;

    this.homey.log(`[${this.getName()}]`, 'Starting loop to try to connect..');
    while (!isConnected) {
      if (useDelay) await new Promise((r) => setTimeout(r, 10000));
      this.homey.log(`[${this.getName()}]`, `Attempt #${attempt}`);

      try {
        this._peripheral = await this._device.connect();
        await this._peripheral.assertConnected();
        await this._peripheral.discoverAllServicesAndCharacteristics();

        this.homey.log(`[${this.getName()}]`, 'Connected to peripheral');
        this.api = new PaxApi(pin, this._peripheral, this.homey);
        isConnected = true;

        this._peripheral.once('disconnect', async () => {
          this.homey.log(`[${this.getName()}]`, 'Disconnected from peripheral, reconnecting..');
          await this.connectToDevice(); // attempt to reconnect
        });
      } catch (error) {
        attempt++;
        useDelay = true;
        this.homey.error(`[${this.getName()}]`, 'Failed to connect to peripheral');
      }
    }
  }

  async _onDeviceInit() {
    await this.connectToDevice();
    this.onSync = this.onSync.bind(this);
    this.onSyncInterval = setInterval(this.onSync, this.constructor.SYNC_INTERVAL);
  }

  async onCapabilitySetFanSpeed(speed, capability) {
    try {
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
      this.homey.log(`[${this.getName()}]`, `Fanspeed (${capability}) set to`, speed, 'RPM');
    } catch (err) {
      this.homey.error(err);
    }
  }

  async boostOnOff(options) {
    /**
     * On (resume) or off (pause) boost
     *
     * @param {Boolean} value - to pause / resume boost
     */
    let func;

    if (options.on) {
      func = this.api.startBoost(options.duration);
    } else {
      func = this.api.stopBoost();
    }

    await func;
  }

  firstRun(mode) {
    if (mode === 'HeatDistributionMode') {
      /*
      * Go through all capabilities on the driver and remove those not supported by device.
      */
      this.homey.log('Removing boost capability for HeatDistributionMode fan.');
      this.removeCapability('boost');
      this.setStoreValue('firstRun', false);
    }
  }

  async onSync() {
    const { firstRun, mode } = this.getStore();

    if (firstRun) this.firstRun(mode);

    if (!this.api.checkConnection) {
      return;
    }

    try {
      // Get fan status
      await this.api.getStatus()
        .then((fanstate) => {
          this.homey.log(`[${this.getName()}]`, fanstate.toString());
          this.setCapabilityValue('measure_temperature', fanstate.Temp).catch((error) => this.homey.error(error));
          this.setCapabilityValue('measure_humidity', fanstate.Humidity).catch((error) => this.homey.error(error));
          this.setCapabilityValue('measure_luminance', fanstate.Light).catch((error) => this.homey.error(error));
          this.setCapabilityValue('measure_rpm', fanstate.RPM).catch((error) => this.homey.error(error));
          this.setCapabilityValue('mode', fanstate.Mode).catch((error) => this.homey.error(error));
        })
        .then(() => this.setAvailable().catch((error) => this.homey.error(error)))
        .catch((error) => this.homey.error(error));

      // Get boost mode status
      if (mode !== 'HeatDistributionMode') {
        await this.api.getBoostMode()
          .then((boostmode) => {
            this.homey.log(`[${this.getName()}]`, boostmode.toString());
            this.setCapabilityValue('boost', !!boostmode.OnOff).catch((error) => this.homey.error(error));
          }).catch((error) => this.homey.error(error));
      }

      // Get fan speed status
      await this.api.getFanSpeed()
        .then((fanspeed) => {
          this.homey.log(`[${this.getName()}]`, fanspeed.toString());
          this.setCapabilityValue('fanspeed.trickle', fanspeed.Trickle).catch((error) => this.homey.error(error));
          this.setCapabilityValue('fanspeed.humidity', fanspeed.Humidity).catch((error) => this.homey.error(error));
          this.setCapabilityValue('fanspeed.light', fanspeed.Light).catch((error) => this.homey.error(error));
        }).catch((error) => this.homey.error(error));
    } catch (error) {
      this.homey.error(error);
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
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.homey.log('PAX Calima device settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.homey.log('PAX Calima device was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  onDeleted() {
    const { onSyncInterval } = this;
    this.isDeleted = true; // Optionally set the flag to true if needed for other functions

    clearInterval(onSyncInterval); // Clear the onSync interval to stop further execution

    if (this._peripheral) {
      this._peripheral.disconnect();
    }

    this.homey.log('PAX Calima device has been deleted');
  }

}

module.exports = PaxCalimaDevice;
