'use strict';

const Homey = require('homey');
const struct = require('python-struct');
const characteristics = require('./characteristics');
const serviceIds = require('./serviceIds');
const FanState = require('./fanstate');
const BoostMode = require('./boostmode');

/**
 * Client for sending requests to a Pax API.
 */
class PaxApi extends Homey.SimpleClass {

  /**
   * Constructs the client.
   * @param {string} pin - Device pincode.
   * @param {object} peripheral - The peripheral.
   * @param {object} homey - Homey instance.
   */
  constructor(pin, peripheral, homey) {
    super();
    this.homey = homey;
    this.peripheral = peripheral;
    this.pin = pin;
  }

  /**
   * Authenticates the peripheral with the given pin code.

   * @param {string} pin - The pin code to use for authentication.
   */
  async auth(pin) {
    try {
      await this.peripheral
        .write(serviceIds.PIN_SERVICE_UUID, characteristics.PIN_CODE, struct.pack('<I', parseInt(pin, 10)));
    } catch (error) {
      throw new Error(`Unable to write PIN to peripheral: ${error}`);
    }
  }

  checkConnection() {
    this.homey.log(this.peripheral);
    if (!this.peripheral?.assertConnected()) {
      this.homey.error(`[${this.getName()}]`, 'Peripheral not found or not connected.');
      return false;
    }

    return true;
  }

  /**
   * Returns the name and mode of the device.
   */
  async getNameAndMode() {
    return {
      name: await this.getName(),
      mode: await this.getMode(),
    };
  }

  /**
   * Returns the name of the device.
   */
  async getName() {
    try {
      const data = await this.peripheral.read(serviceIds.PIN_SERVICE_UUID, characteristics.FAN_DESCRIPTION);
      const name = data.toString();
      this.homey.log(`Got device name: ${name}`);

      return name;
    } catch (error) {
      throw new Error(`Unable to read peripheral: ${error}`);
    }
  }

  /**
   * Get Mode for device.
   */
  async getMode() {
    try {
      const data = await this.peripheral.read(serviceIds.BOOST, characteristics.MODE);
      const mode = ['MultiMode', 'DraftShutterMode', 'WallSwitchExtendedRuntimeMode', 'WallSwitchNoExtendedRuntimeMode', 'HeatDistributionMode'][struct.unpack('<B', data)[0]];
      return mode ?? undefined;
    } catch (error) {
      throw new Error(`Unable to read peripheral: ${error}`);
    }
  }

  /**
   * Get status for device.
   */
  async getStatus() {
    try {
      const data = await this.peripheral.read(serviceIds.STATUS_SERVICE_UUID, characteristics.SENSOR_DATA);

      const v = struct.unpack('<4HBHB', data);
      let trigger = 'No trigger';
      if (((v[4] >> 4) & 1) === 1) {
        trigger = 'Boost';
      } else if ((v[4] & 3) === 1) {
        trigger = 'Trickle ventilation';
      } else if ((v[4] & 3) === 2) {
        trigger = 'Light ventilation';
      } else if ((v[4] & 3) === 3) {
      // Note that the trigger might be active, but mode must be enabled to be activated
        trigger = 'Humidity ventilation';
      }
      return new FanState(
        v[0] > 0 ? Math.round(Math.log2(v[0]) * 10, 2) : 0,
        v[1] / 4,
        v[2],
        v[3],
        trigger,
      );
    } catch (error) {
      throw new Error(`Unable to read peripheral: ${error}`);
    }
  }

  /**
   * Get BoostMode for device.
   */
  async getBoostMode() {
    try {
      const data = await this.peripheral.read(serviceIds.BOOST, characteristics.BOOST);

      const [mode, speed, duration] = struct.unpack('<BHH', data);
      return new BoostMode(mode, speed, duration);
    } catch (error) {
      throw new Error(`Unable to read peripheral: ${error}`);
    }
  }

  startBoost(duration) {
    return this.setBoostMode(1, 2250, duration);
  }

  stopBoost() {
    return this.setBoostMode(0, 0, 0);
  }

  /**
   * Start boost on device.
   * @param on 0 or 1 to turn on or off.
   * @param speed speed, must be multiple of 25.
   * @param seconds how long should boost last.
   */
  async setBoostMode(on, speed, seconds) {
    if (speed % 25 !== 0) {
      throw new Error('Speed must be a multiple of 25');
    }

    try {
      await this.auth(this.pin);
      await this.peripheral.write(serviceIds.BOOST, characteristics.BOOST, struct.pack('<BHH', on, speed, seconds));
    } catch (error) {
      throw new Error(`Unable to set boost mode: ${error}`);
    }
  }

}

module.exports = PaxApi;
