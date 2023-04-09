'use strict';

const Homey = require('homey');
const PaxApi = require('../../lib/api');

class PaxCalimaDevice extends Homey.Device {

  static SYNC_INTERVAL = 1000 * 30; // 30 seconds
  static DEFAULT_BOOST_DURATION = 900;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    const { peripheralUuid, mode } = this.getStore();
    const { pin } = this.getData();

    this.setUnavailable().catch(this.error);

    this.log('device loaded');

    this.printInfo();

    this.setUnavailable().catch(this.error);
    const advertisement = await this.homey.ble.find(peripheralUuid);

    this.api = new PaxApi(pin, advertisement, this.homey);

    this.onSync = this.onSync.bind(this);
    this.onSyncInterval = setInterval(this.onSync, this.constructor.SYNC_INTERVAL);
    this.onSync(); // do an initial sync

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
    this.log('Pax Calima device has been initiated');
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

    if (firstRun) this.firstRun(mode);

    this.log('Syncing...');

    const fanstate = await this.api.getStatus();
    this.log(fanstate.toString());
    this.setCapabilityValue('measure_temperature', fanstate.Temp).catch(this.error);
    this.setCapabilityValue('measure_humidity', fanstate.Humidity).catch(this.error);
    this.setCapabilityValue('measure_luminance', fanstate.Light).catch(this.error);
    this.setCapabilityValue('measure_rpm', fanstate.RPM).catch(this.error);
    this.setCapabilityValue('mode', fanstate.Mode).catch(this.error);

    if (mode !== 'HeatDistributionMode') {
      const boostmode = await this.api.getBoostMode();
      this.setCapabilityValue('boost', !!boostmode.OnOff).catch(this.error);
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
    if (this._peripheral) {
      this._peripheral.disconnect();
    }
    clearInterval(onSyncInterval);
  }

}

module.exports = PaxCalimaDevice;
