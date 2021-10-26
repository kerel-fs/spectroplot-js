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

/*
 * Convert a js Date object to Julian date.
 * @param (Date) - Date
 * @returns {number} - Julian Date
 */
function date2JulianDate(date) {
    return date.valueOf()/86400000 + 2440587.5;
}

class DopplerModel {
    /**
     * @param {[string, string]} tle - The TLE as a tuple of two lines
     * @param {{latitude: number, longitude: number, height: number}}  - The Observer location
     */
    constructor(tle, observer) {
        this.tle = tle;
        this.observer = observer;
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
        let positionAndVelocity = satellite.propagate(satrec, t);
        let observerEcf = satellite.geodeticToEcf({
            longitude: satellite.degreesToRadians(this.observer.longitude),
            latitude: satellite.degreesToRadians(this.observer.latitude),
            height: this.observer.height / 1000,
        });

        const positionEci = positionAndVelocity.position,
              velocityEci = positionAndVelocity.velocity;

        const beta = relativeRangeRate(observerEcf, positionEci, velocityEci);

        if (Number.isNaN(beta)) {
            console.log("ERROR: Propagator returned NaN value.");
        }
        return beta;
    }
}

export {relativeRangeRate, DopplerModel, date2JulianDate};
