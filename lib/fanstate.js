'use strict';

class FanState {

  constructor(humidity, temperature, light, rpm, mode) {
    this.Humidity = humidity;
    this.Temp = temperature;
    this.Light = light;
    this.RPM = rpm;
    this.Mode = mode;
  }

  toString() {
    return `Fan state: Humidity = ${this.Humidity}, Temperature = ${this.Temp}, Light = ${this.Light}, RPM = ${this.RPM}, Mode = ${this.Mode}`;
  }

}

module.exports = FanState;
