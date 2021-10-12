import * as satellite from 'satellite.js';

function relativeRangeRate(location, position, velocity) {
  const mfactor = 7.292115E-5;
  const c = 299792.458; // Speed of light in km/s

  const range = {
    x: position.x - location.x,
    y: position.y - location.y,
    z: position.z - location.z,
  };
  range.w = Math.sqrt(range.x ** 2 + range.y ** 2 + range.z ** 2);

  const rangeVel = {
    x: velocity.x + mfactor * location.y,
    y: velocity.y - mfactor * location.x,
    z: velocity.z,
  };

  const rangeRate = (range.x * rangeVel.x + range.y * rangeVel.y + range.z * rangeVel.z) / range.w;

  return (rangeRate / c);
}


class DopplerModel {
    constructor(tle, observer, start_time) {
        this.tle = tle;
        this.observer = observer;
        this.start_time = start_time;
    }

    getDopplerFactor(t) {
        /*
         * Calculate the Frequency as received by de-compensating the Doppler shift removed by re-tuning the station.
         *
         * Arguments:
         * t - Date
         */
        // Initialize Propagator
        let satrec = satellite.twoline2satrec(this.tle[0], this.tle[1]);
        let positionAndVelocity = satellite.propagate(satrec, this.start_time);
        let observerEcf = satellite.geodeticToEcf({
            longitude: satellite.degreesToRadians(this.observer.longitude),
            latitude: satellite.degreesToRadians(this.observer.latitude),
            height: this.observer.height / 1000,
        });
        positionAndVelocity = satellite.propagate(satrec, t);

        const positionEci = positionAndVelocity.position,
              velocityEci = positionAndVelocity.velocity;

        const beta = relativeRangeRate(observerEcf, positionEci, velocityEci);

        return beta;
    }
}

export {relativeRangeRate, DopplerModel};
