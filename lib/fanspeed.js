'use strict';

class FanSpeed {

  constructor(humidity, light, trickle) {
    this.Humidity = humidity || 2250;
    this.Light = light || 1625;
    this.Trickle = trickle || 1000;
  }

  toString() {
    return `Fanspeed: Humidity = ${this.Humidity}, Light = ${this.Light}, Trickle = ${this.Trickle}`;
  }

}

module.exports = FanSpeed;
