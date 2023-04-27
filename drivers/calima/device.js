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

    this.setUnavailable('Unable to connect to PAX Calima').catch(this.error);

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
        const peripheral = await this._device.connect();
        await peripheral.assertConnected();
        await peripheral.discoverAllServicesAndCharacteristics();

        this.log(`[${this.getName()}]`, 'Connected to peripheral');
        this.api = new PaxApi(pin, peripheral, this.homey);
        isConnected = true;

        peripheral.once('disconnect', async () => {
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
      this.log('Removing boost capability for HeatDistributionMode fan.');
      this.removeCapability('boost');
      this.setStoreValue('firstRun', false);
    }
  }

  async onSync() {
    const { firstRun, mode } = this.getStore();
    this.log(`[${this.getName()}]`, 'Refresh device');

    if (firstRun) this.firstRun(mode);

    if (!this.api.checkConnection) {
      return;
    }

    try {
      await this.api.getStatus()
        .then((fanstate) => {
          this.log(`[${this.getName()}]`, fanstate.toString());
          this.setCapabilityValue('measure_temperature', fanstate.Temp).catch(this.error);
          this.setCapabilityValue('measure_humidity', fanstate.Humidity).catch(this.error);
          this.setCapabilityValue('measure_luminance', fanstate.Light).catch(this.error);
          this.setCapabilityValue('measure_rpm', fanstate.RPM).catch(this.error);
          this.setCapabilityValue('mode', fanstate.Mode).catch(this.error);
          this.setAvailable();
        })
        .catch(this.error);

      if (mode !== 'HeatDistributionMode') {
        await this.api.getBoostMode()
          .then((boostmode) => {
            this.log(`[${this.getName()}]`, boostmode.toString());
            this.setCapabilityValue('boost', !!boostmode.OnOff).catch(this.error);
          }).catch(this.error);
      }
    } catch (error) {
      this.error(error);
    }
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('PAX Calima device has been added');
    this.printInfo();
  }

  printInfo() {
    this.log('name:', this.getName());
    this.log('class:', this.getClass());
    this.log('data', this.getData());
    this.log('store', this.getStore());
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
    this.log('PAX Calima device settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log('PAX Calima device was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  onDeleted() {
    const { onSyncInterval } = this;

    this.log('PAX Calima device has been deleted');
    if (this.api) {
      this.api.disconnect();
    }
    clearInterval(onSyncInterval);
  }

}

module.exports = PaxCalimaDevice;
