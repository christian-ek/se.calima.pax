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
    this._searchDevice(0);
  }

  async _searchDevice(timeout) {
    setTimeout(async () => {
      const { id } = this.getData();
      this._device = await this.homey.ble.find(id);

      if (this._device != null && this._device.id === id) {
        this._onDeviceInit();
      } else {
        this._searchDevice(this.constructor.BLE_SEARCH_TIMEOUT);
      }
    }, timeout * 1000);
  }

  async _onDeviceInit() {
    const { pin } = this.getData();

    this.log(`[${this.getName()}]`, 'Found device advertisement');

    this.api = new PaxApi(pin, this._device, this.homey);
    this.onSync = this.onSync.bind(this);
    this.onSyncInterval = setInterval(this.onSync, this.constructor.SYNC_INTERVAL);
    this.onSync(); // do an initial sync
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

    try {
      const fanstate = await this.api.getStatus();
      this.log(`[${this.getName()}]`, fanstate.toString());
      this.setCapabilityValue('measure_temperature', fanstate.Temp).catch(this.error);
      this.setCapabilityValue('measure_humidity', fanstate.Humidity).catch(this.error);
      this.setCapabilityValue('measure_luminance', fanstate.Light).catch(this.error);
      this.setCapabilityValue('measure_rpm', fanstate.RPM).catch(this.error);
      this.setCapabilityValue('mode', fanstate.Mode).catch(this.error);

      if (mode !== 'HeatDistributionMode') {
        const boostmode = await this.api.getBoostMode();
        this.log(`[${this.getName()}]`, boostmode.toString());
        this.setCapabilityValue('boost', !!boostmode.OnOff).catch(this.error);
      }

      this.setAvailable();
    } catch (error) {
      this.homey.error(error);
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
