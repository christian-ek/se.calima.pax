'use strict';

class BoostMode {

  constructor(onOff, speed, seconds) {
    this.OnOff = onOff;
    this.Speed = speed;
    this.Seconds = seconds;
  }

  toString() {
    return `BoostMode: OnOff = ${this.OnOff}, Speed = ${this.Speed}, Seconds = ${this.Seconds}`;
  }

}

module.exports = BoostMode;
