'use strict';

// Shoutout to https://github.com/PatrickE94/pycalima/ for the python version which helped me out greatly.

const Homey = require('homey');
const struct = require('python-struct');
const characteristics = require('./characteristics');
const serviceIds = require('./serviceIds');
const FanState = require('./fanstate');
const BoostMode = require('./boostmode');

/**
  * Client for sendi
  */
class PaxApi extends Homey.SimpleClass {

  /**
   * Construct the client
   * @param {string} pin - Device pincode
   * @param {object} advertisement - Advertisement object
   * @param {object} homey - Homey instance
   */
  constructor(pin, advertisement, homey) {
    super();
    this.homey = homey;
    this.advertisement = advertisement;
    this.pin = pin;
    this._peripheral = null;
  }

  async getPeripheral() {
    if (!this.advertisement) {
      return Promise.reject(new Error('Advertisement Unavailable'));
    }

    if (!this._peripheral) {
      await this.advertisement.connect().then(async (peripheral) => {
        await peripheral.assertConnected();
        await peripheral.discoverAllServicesAndCharacteristics();
        this._peripheral = peripheral;
      }).catch(this.homey.error);

      this._peripheral.once('disconnect', () => {
        this._peripheral = null;
      });
    }

    return new Promise((resolve, reject) => {
      if (this._peripheral) {
        resolve(this._peripheral);
      }
      reject();
    });
  }

  async auth(peripheral, pin) {
    // Auth
    if (pin) {
      this.homey.log('Writing pin to peripheral..');

      await peripheral.write(serviceIds.PIN_SERVICE_UUID, characteristics.PIN_CODE, struct.pack('<I', parseInt(pin, 10)))
        .catch(this.homey.error);
    }
    return peripheral;
  }

  async getNameAndMode() {
    const name = await this.getName();
    const mode = await this.getMode();
    return { name, mode };
  }

  /**
   * Get name of device.
   */
  getName() {
    return new Promise((resolve, reject) => {
      this.getPeripheral()
        .then((peripheral) => this.auth(peripheral, this.pin))
        .then((peripheral) => {
          peripheral.read(serviceIds.PIN_SERVICE_UUID, characteristics.FAN_DESCRIPTION)
            .then((data) => {
              this.homey.log(`Got device name: ${data.toString()}`);
              resolve(data.toString());
            })
            .catch((error) => {
              reject(error);
            });
        })
        .catch((error) => {
          return reject(error);
        })
        .finally(async () => {
          if (this._peripheral) {
            // await this._peripheral.disconnect();
          }
        });
    });
  }

  /**
   * Get status for device.
   */
  getStatus() {
    return new Promise((resolve, reject) => {
      this.getPeripheral()
        .then((peripheral) => {
          peripheral.read(serviceIds.STATUS_SERVICE_UUID, characteristics.SENSOR_DATA)
            .then(async (data) => {
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
              resolve(new FanState(
                v[0] > 0 ? Math.round(Math.log2(v[0]) * 10, 2) : 0,
                v[1] / 4,
                v[2],
                v[3],
                trigger,
              ));
            })
            .catch(reject);
        })
        .catch(reject)
        .finally(async () => {
          if (this._peripheral) {
            // await this._peripheral.disconnect();
          }
        });
    });
  }

  /**
   * Get BoostMode for device.
   */
  getMode() {
    return new Promise((resolve, reject) => {
      this.getPeripheral()
        .then((peripheral) => {
          peripheral.read(serviceIds.BOOST, characteristics.MODE)
            .then(async (data) => {
              const value = struct.unpack('<B', data);
              let mode;

              switch (value[0]) {
                case 0:
                  mode = 'MultiMode';
                  break;
                case 1:
                  mode = 'DraftShutterMode';
                  break;
                case 2:
                  mode = 'WallSwitchExtendedRuntimeMode';
                  break;
                case 3:
                  mode = 'WallSwitchNoExtendedRuntimeMode';
                  break;
                case 4:
                  mode = 'HeatDistributionMode';
                  break;
                default:
                  mode = undefined;
              }
              resolve(mode);
            })
            .catch(reject);
        })
        .catch(reject)
        .finally(async () => {
          if (this._peripheral) {
            // await this._peripheral.disconnect();
          }
        });
    });
  }

  /**
   * Get BoostMode for device.
   */
  getBoostMode() {
    return new Promise((resolve, reject) => {
      this.getPeripheral()
        .then((peripheral) => {
          peripheral.read(serviceIds.BOOST, characteristics.BOOST)
            .then(async (data) => {
              const v = struct.unpack('<BHH', data);
              resolve(new BoostMode(v[0], v[1], v[2]));
            })
            .catch(reject);
        })
        .catch(reject)
        .finally(async () => {
          if (this._peripheral) {
            // await this._peripheral.disconnect();
          }
        });
    });
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
  setBoostMode(on, speed, seconds) {
    return new Promise((resolve, reject) => {
      if (speed % 25 !== 0) {
        reject(Error('Speed must be a multiple of 25'));
      }

      this.homey.log(`Setting boost mode to on=${on}, speed=${speed}, seconds=${seconds}`);
      this.getPeripheral()
        .then((peripheral) => this.auth(peripheral, this.pin))
        .then((peripheral) => {
          peripheral.write(serviceIds.BOOST, characteristics.BOOST, struct.pack('<BHH', on, speed, seconds))
            .then(async (data) => {
              resolve();
            })
            .catch((err) => {
              this.homey.error(`Failed to set boost mode: ${err}`);
              reject(err);
            });
        })
        .catch((error) => {
          return reject(error);
        })
        .finally(() => {
          if (this._peripheral) {
            // this._peripheral.disconnect();
          }
        });
    });
  }

}

module.exports = PaxApi;
