/**
    @file I/Q Spectrogramm Plot JS.

    @author Christian W. Zuckschwerdt <zany@triq.net>
    @copyright Christian W. Zuckschwerdt, 2019
    @license
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 2 of the License, or
    (at your option) any later version.
*/

/*eslint no-console: "off"*/

import './polyfill.js';

import * as windows from './windows.js';

import { autorange } from './autorange.js';
import { autostep } from './autostep.js';
import { parseFreqRate, parseFormat } from './parseFreqRate.js';

import * as cube1cmap from './cube1cmap.js';
import * as soxcmap from './soxcmap.js';
import * as naivecmap from './naivecmap.js';
import * as matplotlibcmaps from './matplotlibcmaps.js';
import * as parabolacmap from './parabolacmap.js';

import { selector, lookup, strip } from './utils.js';

import SampleView from './samples.js';
import { DropZone } from './dropzone.js';

import * as hdf5 from 'jsfive';

import * as satellite from 'satellite.js';

import {relativeRangeRate, DopplerModel, date2ModifiedJulianDate} from './dopplerFactor.js';

// import Worker from 'worker-loader!./worker.js';
// import Worker from 'worker-loader?filename=spectroplot.worker.js!./worker.js';
// const worker_url = new URL('./worker.js', import.meta.url)

//import './styles.css';

// kind of a crowbar until I figure something better out
const cmaps = Object.assign({}, cube1cmap, soxcmap, naivecmap, matplotlibcmaps, parabolacmap);

// polyfill ImageData constructor
function newImageData() {
    var i = 0;
    if (arguments[0] instanceof Uint8ClampedArray) {
        var data = arguments[i++];
    }
    var width = arguments[i++];
    var height = arguments[i];
    if (data && height === undefined) height = data.length / 4 / width;

    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d', { alpha: false });
    var imageData = ctx.createImageData(width, height);
    if (data) imageData.data.set(data);
    return imageData;
}

// Check for the various File API support.
if (window.File && window.FileReader && window.FileList && window.Blob) {
    // Great success! All the File APIs are supported.
} else {
    alert('The File APIs are not fully supported in this browser.');
}

let resizeTimer;

window.addEventListener('resize', function () {

    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {

        // Dispatch the event.
        const event = new Event('debouncedResize');
        window.dispatchEvent(event);

    }, 250);

}, false);


if (!navigator.hardwareConcurrency)
    console.error('The hardwareConcurrency APIs are not fully supported in this browser.');
const renderWorkerCount = navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
// console.log(`Creating ${renderWorkerCount} render workers.`);
// narrowly tailored Promise for multiplexed worker access, relies on sequential worker execution
let renderWorker = new Array(renderWorkerCount);
let renderCallbacks = new Array(renderWorkerCount);

function renderPromise(i, message, transfer) {
    return new Promise(resolve => {
        renderCallbacks[i].push(resolve);
        renderWorker[i].postMessage(message, transfer);
    });
}

export function startWorkers() {
    if (window.Worker) {
        // console.log(`Starting ${renderWorkerCount} render workers.`);

        for (let i = 0; i < renderWorkerCount; ++i) {
            renderWorker[i] = new Worker(new URL('./worker.js', import.meta.url));
            renderCallbacks[i] = [];
            renderWorker[i].onmessage = (msg) => {
                const callback = renderCallbacks[i].shift();
                if (callback)
                    callback(msg);
            };
        }

        const ab = new ArrayBuffer(1);
        renderWorker[0].postMessage({ transferable: ab}, [ab]);
        if (ab.byteLength) {
            // console.log('Transferables are not supported in your browser!');
        } else {
            // Transferables are supported.
        }

    } else {
        alert('The Worker APIs are not fully supported in this browser.');
        // TODO: emulate web worker.
    }
}

/**
    Predefined Window functions.
    @readonly
    @enum {string}
*/
// eslint-disable-next-line no-unused-vars
const WindowF = {
    /** Rectangular window function */
    rectangular: 'rectangular',
    /** Bartlett window function */
    bartlett: 'bartlett',
    /** Hamming window function */
    hamming: 'hamming',
    /** Hann window function */
    hann: 'hann',
    /** Blackman window function */
    blackman: 'blackman',
    /** Blackman - Harris window function */
    blackmanHarris: 'blackmanHarris',
}

/**
    Custom Window function.
    @callback CustomWindowF
    @param {number} n - FFT width
    @returns {{ window: number[], weight: number }}
*/

/**
    RGB triplet.
    @typedef RGB
    @type {number[]}
*/

/**
    Predefined Color maps.
    @readonly
    @enum {string}
*/
// eslint-disable-next-line no-unused-vars
const Cmap = {
    /** Cube1 color map */
    cube1: 'cube1',
    /** Viridis color map */
    viridis: 'viridis',
    /** Plasma color map */
    plasma: 'plasma',
    /** Inferno color map */
    inferno: 'inferno',
    /** Magma color map */
    magma: 'magma',
    /** Hot color map */
    hot: 'hot',
    /** Afmhot color map */
    afmhot: 'afmhot',
    /** Gist heat color map */
    gist_heat: 'gist_heat',
    /** Naive color map */
    naive: 'naive',
    /** Parabola color map */
    parabola: 'parabola',
    /** Sox color map */
    sox: 'sox',
    /** Gray color map */
    grayscale: 'grayscale',
    /** Röntgen color map */
    roentgen: 'roentgen',
    /** Phosphor color map */
    phosphor: 'phosphor',
}

export { Spectroplot }

/**
    The main Spectroplot class.
*/
class Spectroplot {
    wf_metadata = {};
    /**
        Initialize a new Spectroplot.

        @param {Object} options
        @param {number} [options.fftN=512] - FFT width, powers of 2 only
        @param {number} [options.width=3000] - canvas width in px
        @param {number} [options.height=512] - canvas height in px, 0 = auto
        @param {number} [options.zoom=1] - Zoom factor
        @param {WindowF|CustomWindowF} [options.windowF=blackmanHarris] - Window name or custom function
        @param {number} [options.gain=6] - Gain in dB
        @param {number} [options.range=30] - Range in dB
        @param {Cmap|RGB[]} [options.cmap=cube1] - Color map name or custom map
        @param {number} [options.ampHeight=0] - Amp bar height in px, 0 = off
        @param {number} [options.minmaxHeight=20] - MinMax bar height in px, 0 = off
        @param {string|Boolean} [options.channelMode=false] - Mode `'I/Q'` (false) or `'L/R'` (true)
        @param {number} [options.dbfsWidth=60] - dbfs width in px
        @param {number} [options.dbfsHeight=0] - 0 = auto: height + timeHeight
        @param {number} [options.freqWidth=40] - Freq width in px
        @param {number} [options.timeHeight=20] - Time height in px
        @param {number} [options.rampHeight=0] - Color ramp height in px, 0 = auto
        @param {number} [options.rampTop=10] - Color ramp top offset in px
        @param {number} [options.rampWidth=15] - Color ramp width in px
        @param {number} [options.histWidth=100] - Histogram width in px
        @param {number} [options.histLeft=55] - Histogramm left offset in px
        @param {string|Object} options.parent - Container element or selector
        @param {string|Object} [options.renderInfo] - Info element or selector
        @param {string|Object} [options.theme] - Theme name or options, see {@link setTheme}
    */
    constructor(options) {
        this.constrain = {
            fftN: value => parseInt(value, 10) || 512, // 2 ** ~~(Math.log2(n) + 0.5)
            height: value => parseInt(value, 10) || 0,
            windowF: value => lookup(windows, value) || windows.blackmanHarrisWindow,
            zoom: value => parseInt(value, 10) || 1,
            gain: value => parseInt(value, 10) || 0,
            range: value => parseInt(value, 10) || 30,
            dynRange: value => (typeof value === 'string') ? !value.toLowerCase().startsWith('f') : value,
            cmap: value => lookup(cmaps, value) || cmaps.cube1_cmap,
            ampHeight: value => parseInt(value, 10) || 0,
            minmaxHeight: value => parseInt(value, 10) || 0,
            histWidth: value => parseInt(value, 10) || 0,
            channelMode: value => (typeof value === 'string') ? !value.toLowerCase().startsWith('i') : value,
            turnFlip: value => (typeof value === 'string') ? !value.toLowerCase().startsWith('s') : value,
        }
        let defaults = {
            fftN: 512, // powers of 2 only
            width: 3000,
            height: 512, // 0 = auto
            zoom: 1,
            windowF: windows.blackmanHarrisWindow,
            gain: 6,
            range: 30,
            cmap: cmaps.viridis_cmap,
            ampHeight: 0,
            minmaxHeight: 20,
            channelMode: false,
            turnFlip: false,

            dbfsWidth: 60,
            dbfsHeight: 0, // 0 = auto: height + timeHeight
            freqWidth: 40,
            timeHeight: 20,
            rampHeight: 0, // 0 = auto
            rampTop: 10,
            rampWidth: 15,
            histWidth: 100,
            histLeft: 55,

            scrollElY: document.documentElement,
        };
        options = Object.assign({}, defaults, options);

        this.tag = Math.random().toString().substring(2); // unique instance tag
        this.buffer = null;
        this.fileinfo = null;
        this.parent = selector(options.parent);
        this.fftN = options.fftN;
        this.width = options.width;
        this.height = options.height;
        this.zoom = options.zoom;
        this.windowF = lookup(windows, options.windowF);
        this.gain = options.gain;
        this.range = options.range;
        this.cmap = lookup(cmaps, options.cmap);
        this.ampHeight = options.ampHeight;
        this.minmaxHeight = options.minmaxHeight;
        this.channelMode = options.channelMode;
        this.turnFlip = options.turnFlip;
        this.histWidth = options.histWidth;
        this.renderInfo = options.renderInfo;
        this.scrollElY = options.scrollElY
        this.setTheme(options.theme);
        this.opts = options;
        this.measurements = [];

        if (!renderWorker[0])
            startWorkers()

        if (options.filedata)
            this.setData(options.filedata);

        if (window.ResizeObserver) {
            // currently only with recent Edge, Firefox, Chrome, Opera
            this.resizeObserver = new ResizeObserver(() => {
                this.processData()
            })
            this.resizeObserver.observe(this.parent)
        } else {
            // won't detect layout changes though
            window.addEventListener('debouncedResize', this, false)
        }
    }

    /**
        Enables mouse-over guide drawing.
    */
    enableGuides() {
        const guides = this.parent.getElementsByClassName('guides')[0];
        let events = ['mousedown', 'mousemove', 'mouseup', 'wheel'];
        if ('ontouchstart' in window) {
            events = events.concat('touchstart', 'touchmove', 'touchend');
        }
        events.forEach(evt => guides.addEventListener(evt, this, false));
    }

    /**
        Disables mouse-over guide drawing.
    */
    disableGuides() {
        const guides = this.parent.getElementsByClassName('guides')[0];
        let events = ['mousedown', 'mousemove', 'mouseup', 'wheel'];
        if ('ontouchstart' in window) {
            events = events.concat('touchstart', 'touchmove', 'touchend');
        }
        events.forEach(evt => guides.removeEventListener(evt, this, false));
    }

    /**
        Hooks up common button elements to the setter functions.
    */
    enableButtons() {
        let buttons = ['fftN', 'height', 'windowF', 'zoom', 'gain', 'range', 'dynRange', 'cmap', 'ampHeight', 'minmaxHeight', 'histWidth', 'channelMode', 'turnFlip']
        buttons.forEach(btn => {
            const els = this.parent.getElementsByClassName(btn)
            for (let el of els) {
                el.addEventListener('change', (e) => this.setOption(btn, e.target.value), false)
            }
        })
        const els = this.parent.getElementsByClassName('theme')
        for (let el of els) {
            el.addEventListener('change', (e) => this.setTheme(e.target.value), false)
        }
        let actions = ['zoomOut', 'zoomFit', 'zoomIn']
        actions.forEach(btn => {
            const els = this.parent.getElementsByClassName(btn)
            for (let el of els) {
                el.addEventListener('click', (e) => this[btn](e), false)
            }
        })
    }

    /**
        Add an entry to the measurements table.
    */
    measurementsAdd(dt, df) {
        // Convert relative to absolute measurements
        const t = new Date(this.wf_metadata.start_time.getTime() + 1000 * dt);
        const f =  this.obs_metadata.frequency * (1 - this.doppler.getDopplerFactor(t)) + df * 1000;

        const table = document.getElementById('measurements');

        // Update DOM
        if (this.measurements.length == 0) {
            // Remove placeholder row
            table.deleteRow(-1);
        }

        let row = table.insertRow(-1);
        let cell_dt = row.insertCell(0);
        let cell_df = row.insertCell(1);
        let cell_t = row.insertCell(2);
        let cell_f = row.insertCell(3);

        cell_dt.innerHTML = `${dt.toFixed(1)}`;
        cell_df.innerHTML = `${df.toFixed(3)}`;
        cell_t.innerHTML = `${date2ModifiedJulianDate(t).toFixed(5)}`;
        cell_f.innerHTML = `${f.toFixed(0)}`;


        // Update object
        this.measurements.push({dt: dt.toFixed(1),
                                df: df.toFixed(3),
                                t: date2ModifiedJulianDate(t),
                                f: f});
    }

    /*
     * Return the measurements, in an STRF-compatible format, as URI-encoded file
     * @returns {string} - URI-encoded measurements file
     */
    getMeasurements() {
        let lines = [];
        this.measurements.forEach(function(measurement, index, array) {
            lines.push([measurement.t.toFixed(6),
                        measurement.f.toFixed(2),
                        "1.0",
                        "9999"].join('\t'));
        });
        const content = "data:text/csv;charset=utf-8," + lines.join('\n') + '\n';
        return encodeURI(content);
    }

    /**
      Enable measurements by mouse click in the waterfall
    */
    enableCanvasClick() {
        document.getElementsByClassName('guides')[0].addEventListener('click', this.canvasClicked.bind(this));
    }

    /**
      * Event Handler for a click inside the Waterfall.
      *
      * @param {MouseEvent} - The click event
      */
    canvasClicked(e) {
        // Make sure the Output is visible
        document.getElementById('output').style.display = null;

        const width = this.turnFlip ? this.height || this.fftN : this.width;
        const fft_height = this.turnFlip ? this.width : this.height || this.fftN;

        const rect = document.getElementsByClassName('guides')[0].getBoundingClientRect();

        const x = e.clientX - rect.left;
        const y = fft_height - (e.clientY - rect.top);

        if (y < 0) {
            // Click outside of Waterfall
            return;
        }

        const df = (x / width - 0.5 ) * this.sample_rate / 1000; // in kHz
        const dt = y / fft_height * this.wf_metadata.total_time; // in s


        this.measurementsAdd(dt, df);
    }


    /**
        Set a color theme.

        @param {string|Object} options - Theme name or theme options
        @param {string} [options.histoStroke=#b0b] - Histogram line color
        @param {string} [options.histoFill=rgba(187,0,187,0.2)] - Histogram fill color
        @param {number} [options.histoLine=2] - Histogram line width
        @param {string} [options.dbfsStroke=#999] - FS-Histogram line color
        @param {string} [options.dbfsFill=rgba(153,153,153,0.2)] - FS-Histogram fill color
        @param {number} [options.dbfsLine=2] - FS-Histogram line width
        @param {string} [options.rampFill=#666] - Color ramp text color
        @param {string} [options.freqLabelFill=#333] - Freq label text color
        @param {string} [options.freqMinorFill=#CCC] - Freq minor tick color
        @param {string} [options.freqMajorFill=#666] - Freq major tick color
        @param {string} [options.freqMarkeFill=#F00] - Freq marker tick color
        @param {string} [options.timeLabelFill=#333] - Time label text color
        @param {string} [options.timeMinorFill=#CCC] - Time minor tick color
        @param {string} [options.timeMajorFill=#666] - Time major tick color
        @param {string} [options.guidesBgFill=rgba(0,0,0,0.3)] - Guides background color
        @param {string} [options.guidesDragFill=rgba(0,0,0,0.3)] - Guides drag color
        @param {string} [options.guidesHairStroke=#fff] - Guides hair color
        @param {string} [options.guidesInfoBgFill=rgba(255,255,255,0.8)] - Guides info background color
        @param {string} [options.guidesInfoTextFill=#666] - Guides info text color
    */
    setTheme(options) {
        let defaults = {
            histoStroke: '#b0b',
            histoFill: 'rgba(187,0,187,0.2)',
            histoLine: 2,
            dbfsStroke: '#999',
            dbfsFill: 'rgba(153,153,153,0.2)',
            dbfsLine: 2,
            rampFill: '#666',
            freqLabelFill: '#333',
            freqMinorFill: '#CCC',
            freqMajorFill: '#666',
            freqMarkerFill: '#F00',
            timeLabelFill: '#333',
            timeMinorFill: '#CCC',
            timeMajorFill: '#666',
            guidesBgFill: 'rgba(0,0,0,0.3)',
            guidesDragFill: 'rgba(0,0,0,0.3)',
            guidesHairStroke: '#fff',
            guidesInfoBgFill: 'rgba(255,255,255,0.8)',
            guidesInfoTextFill: '#666',
            overlayStroke: '#F00',
            overlayLine: 2,
            //minmaxCmap: colorRamp,
            //ampCmap: colorRamp,
        }
        const themes = {}
        themes.dark = {
            histoStroke: '#b0b',
            histoFill: 'rgba(191,0,191,0.2)',
            dbfsStroke: '#999',
            dbfsFill: 'rgba(153,153,153,0.2)',
            rampFill: '#999',
            freqLabelFill: '#DDD',
            freqMinorFill: '#666',
            freqMajorFill: '#999',
            freqMarkerFill: '#C00',
            timeLabelFill: '#DDD',
            timeMinorFill: '#666',
            timeMajorFill: '#999',
            guidesBgFill: 'rgba(0,0,0,0.3)',
            guidesDragFill: 'rgba(0,0,0,0.3)',
            guidesHairStroke: '#fff',
            guidesInfoBgFill: 'rgba(255,255,255,0.8)',
            guidesInfoTextFill: '#666',
            //minmaxCmap: colorRamp,
            //ampCmap: colorRamp,
        }
        if (typeof options === 'string' && themes[options]) defaults = themes[options]
        this.theme = Object.assign({}, defaults, options);
        return this.processData()
    }

    /** Release all event handlers and resources. */
    destroy() {
        if (this.dropZone)
            this.dropZone.destroy()
        if (this.resizeObserver)
            this.resizeObserver.disconnect()
        window.removeEventListener('debouncedResize', this, false);
        this.disableGuides()
        if (ArrayBuffer.transfer)
            ArrayBuffer.transfer(this.buffer, 0);
    }

    /**
        Set an option on the Spectroplot to some value.
        @param {string} opt - Option name, see {@link #new_Spectroplot_new new}
        @param {Object} value - The new value for the option
        @returns {Promise} A promise that resolves when the redrawing is complete
    */
    setOption(opt, value) {
        this[opt] = this.constrain[opt](value)
        return this.processData()
    }

    /**
        Set a number of options on the Spectroplot to some values.
        @param {Object} opts - A key/value object of options to set, see {@link #new_Spectroplot_new new}
        @returns {Promise} A promise that resolves when the redrawing is complete
    */
    setOptions(opts) {
        for (let opt in opts) {
            this[opt] = this.constrain[opt](opts[opt])
        }
        return this.processData()
    }

    /**
        Set new data on the Spectroplot.
        @param {string|Object} filedata - A URL string or File data object of `{ fileBuffer: ArrayBuffer, name: string, size: number, type: string }`
        @returns {Promise} A promise that resolves when the redrawing is complete
    */
    setData(filedata) {
        let promise;
        // handle if the arg is a url
        if (typeof filedata === 'string') {
            promise = loadUrl(filedata);
        } else {
            promise = Promise.resolve(filedata);
        }

        // TODO: if there is no resolved arrayBuffer we should trigger a load

        if (filedata.name.endsWith('h5') || filedata.name.endsWith('hdf5')) {
            //console.log(filedata);
            const hdf5_file = new hdf5.File(filedata.fileBuffer, filedata.name);
            //console.log(hdf5_file);

            // console.log(hdf5_file.attrs);
            // const artifact_version = hdf5_file.attrs['artifact_version']
            // const observation_id = hdf5_file.attrs['observation_id']

            // Main waterfall group
            const wf_group = hdf5_file.get('waterfall')
            // Group waterfall attributes
            //const offset_in_stds = wf_group.attrs['offset_in_stds']
            //const scale_in_stds = wf_group.attrs['scale_in_stds']

            // console.log(wf_group.attrs);
            // absolute_time_unit: "seconds"
            // data_max_unit: "dB"
            // data_min_unit: "dB"
            // data_unit: "div"
            // frequency_unit: "kHz"
            // offset_in_stds: -2
            // offset_unit: "dB"
            // relative_time_unit: "seconds"
            // scale_in_stds: 8
            // scale_unit: "dB/div"
            // start_time: "2020-11-22T16:11:42.412213Z"

            const wf_offset = wf_group.get('offset')
            // console.log(wf_offset.attrs); // 'DIMENSION_LABELS' of 1024
            const wf_scale = wf_group.get('scale')
            // console.log(wf_scale.attrs); // 'DIMENSION_LABELS' of 1024
            const wf_data = wf_group.get('data')
            // console.log(wf_data.attrs); // 'DIMENSION_LABELS' of 5977 x 1024

            // console.log('shape:', wf_data.shape);
            // console.log('dtype:', wf_data.dtype);
            // console.log('fillvalue:', wf_data.fillvalue);

            const wf_relative_time = wf_group.get('relative_time')
            // console.log(wf_relative_time.attrs); // 'DIMENSION_LABELS' of 5977
            const wf_absolute_time = wf_group.get('absolute_time')
            // console.log(wf_absolute_time.attrs); // 'DIMENSION_LABELS' of 5977
            const wf_frequency = wf_group.get('frequency')
            // console.log(wf_frequency.attrs); // 'DIMENSION_LABELS' of 1024

            const width = wf_data.shape[1]

            // console.time('h5 wf_offset.value ' + this.tag);
            const wf_offset_value = wf_offset.value
            // console.timeEnd('h5 wf_offset.value ' + this.tag);

            // console.time('h5 wf_scale.value ' + this.tag);
            const wf_scale_value = wf_scale.value
            // console.timeEnd('h5 wf_scale.value ' + this.tag);

            // console.log(wf_scale_value)
            let offset_min = wf_offset_value[0]
            let offset_max = wf_offset_value[0]
            let scale_min = wf_scale_value[0]
            let scale_max = wf_scale_value[0]
            for (let x = 1; x < width; ++x) {
                if (wf_offset_value[x] < offset_min) offset_min = wf_offset_value[x]
                if (wf_offset_value[x] > offset_max) offset_max = wf_offset_value[x]
                if (wf_scale_value[x] < scale_min) scale_min = wf_scale_value[x]
                if (wf_scale_value[x] > scale_max) scale_max = wf_scale_value[x]
            }
            // console.log(offset_min, offset_max, scale_min, scale_max)

            // console.time('h5 wf_data.value ' + this.tag);
            // this.buffer = wf_data.value // NOTE: this is extremly heavy load
            this.buffer = filedata.fileBuffer
            // console.timeEnd('h5 wf_data.value ' + this.tag);
            this.hdf5_file = hdf5_file
            this.offset_min = offset_min
            this.offset_max = offset_max
            this.scale_min = scale_min
            this.scale_max = scale_max
            const db_min = offset_min
            const db_max = offset_max + scale_max * 255
            this.gain = ~~(-db_max)
            this.range = ~~(db_max - db_min)

            return this.processData();
        }

        return promise
            .then(filedata => {
                this.fileinfo = filedata;
                this.buffer = filedata.fileBuffer;
                this.sampleFormat = parseFormat(filedata.name);
                this.sampleCount = null;
                const nameInfo = parseFreqRate(filedata.name);
                this.center_freq = nameInfo.freq;
                this.sample_rate = nameInfo.rate;

                this.sampleView = new SampleView(this.sampleFormat, null, this.sample_rate, this.center_freq)
                return this.sampleView.loadBuffer(this.buffer)
            })
            .then(() => {
                this.sample_rate = this.sampleView.sampleRate;
                this.buildInfo();
                return this.processData();
            })
    }

    zoomOut() {
        if (this.zoom <= 1) return Promise.resolve();
        this.zoom -= 0.5;
        return this.processData();
    }
    zoomFit() {
        if (this.zoom == 1) return Promise.resolve();
        this.zoom = 1;
        return this.processData();
    }
    zoomIn() {
        if (this.zoom >= 8) return Promise.resolve();
        this.zoom += 0.5;
        return this.processData();
    }

    setFftN(value) {
        this.fftN = this.constrain['fftN'](value);
        return this.processData();
    }
    setHeight(value) {
        this.height = this.constrain['height'](value);
        return this.processData();
    }
    setWindowF(value) {
        this.windowF = this.constrain['windowF'](value);
        return this.processData();
    }
    setZoom(value) {
        this.zoom = this.constrain['zoom'](value);
        return this.processData();
    }
    setGain(value) {
        this.gain = this.constrain['gain'](value);
        return this.processData();
    }
    setRange(value) {
        this.range = this.constrain['range'](value);
        return this.processData();
    }
    setDynRange(value) {
        this.dynRange = this.constrain['dynRange'](value);
        return this.processData();
    }
    setCmap(value) {
        this.cmap = this.constrain['cmap'](value);
        return this.processData();
    }
    setAmpHeight(value) {
        this.ampHeight = this.constrain['ampHeight'](value);
        return this.processData();
    }
    setMinmaxHeight(value) {
        this.minmaxHeight = this.constrain['minmaxHeight'](value);
        return this.processData();
    }
    setHistWidth(value) {
        this.histWidth = this.constrain['histWidth'](value);
        return this.processData();
    }
    setChannelMode(value) {
        this.channelMode = this.constrain['channelMode'](value);
        return this.processData();
    }
    setTurnFlip(value) {
        this.turnFlip = this.constrain['turnFlip'](value);
        return this.processData();
    }

    buildInfo() {
        const base_scale = autorange(this.center_freq, 10.0);
        const rate_scale = autorange(this.sample_rate, 10.0);
        const file = this.fileinfo;

        // TODO: refactor
        //const sampleWidth = this.sampleView.sampleWidth;
        const sampleCount = this.sampleCount || this.sampleView.sampleCount;
        const stride = (sampleCount - this.fftN) / (this.width - 1);

        const lastModified = file.lastModifiedDate || new Date(file.lastModified || 0); // use lastModifiedDate only on IE

        const infos = []
        infos.push({ text: 'File name', value: strip(file.name) })
        infos.push({ text: 'File type', value: file.type || 'n/a' })
        infos.push({ text: 'File size', value: `${file.size} bytes` })
        infos.push({ text: 'Last modified', value: lastModified.toISOString() })
        infos.push({ text: 'Sample format', value: this.sampleFormat })
        infos.push({ text: 'No. of samples', value: `${sampleCount} S` })
        infos.push({ text: 'Stride (window to window)', value: `× ${stride.toFixed(1)}` })
        if (this.center_freq)
            infos.push({ text: 'Center frequency', value: `${this.center_freq / base_scale.scale}${base_scale.prefix}` })
        if (this.sample_rate > 1)
            infos.push({ text: 'Sample rate', value: `${this.sample_rate / rate_scale.scale}${rate_scale.prefix}` })
        if (this.sample_rate > 1)
            infos.push({ text: 'Length (time)', value: `${(sampleCount / this.sample_rate).toFixed(3)} s` })
        if (this.dBfs_min)
            infos.push({ text: 'dBfs scale', value: `${this.dBfs_min.toFixed(1)} dB – ${this.dBfs_max.toFixed(1)} dB` })

        if (this.renderInfo) {
            this.renderInfo(infos)
        } else {
            let text = ''
            for (let item of infos) {
                text += `<span title="${item.text}">${item.value}</span>`
            }
            const info = this.parent.parentNode.getElementsByClassName('fileinfo')[0];
            info.innerHTML = text

        }
    }

    drawColorRamp() {
        const gain = this.gain;
        const dB_range = this.range;
        const height = this.height || this.fftN;

        // draw color ramp
        const dbfsWidth = this.opts.dbfsWidth + this.histWidth;
        const dbfsHeight = height + this.opts.timeHeight; // this.opts.dbfsHeight;
        const dbfsCanvas = this.parent.getElementsByClassName('dbfs')[0];
        dbfsCanvas.width = dbfsWidth;
        dbfsCanvas.height = dbfsHeight;
        dbfsCanvas.style.width = dbfsCanvas.width + 'px';
        dbfsCanvas.parentNode.style.width = dbfsCanvas.width + 'px';
        //dbfsCanvas.style.height = dbfsCanvas.height;
        const dbfsCtx = dbfsCanvas.getContext('2d');
        dbfsCtx.font = '10px sans-serif';
        const font_y = 10;

        const rampWidth = this.opts.rampWidth;
        const rampHeight = height;
        const rampLeft = 35; // space for the ramp marker
        const rampTop = this.opts.rampTop;
        const rampData = newImageData(rampWidth, rampHeight);
        const cmap = this.cmap;
        const color_max = cmap.length - 1;

        for (let y = 0; y < rampHeight; ++y) {
            for (let x = 0; x < rampWidth; ++x) {
                const idx = Math.round(y * color_max / (rampHeight - 1));
                const p = color_max - idx;
                const color = cmap[p];
                const j = x * 4 + rampWidth * y * 4;
                rampData.data[j + 0] = color[0]; // R
                rampData.data[j + 1] = color[1]; // G
                rampData.data[j + 2] = color[2]; // B
                rampData.data[j + 3] = 255; // A
                //dbfsCtx.fillRect(rangeWidth - 5, y, 5, 1);

            }
        }
        dbfsCtx.putImageData(rampData, rampLeft, rampTop);

        // draw dbFS marker
        // want a dbFS marker for about every 70 pixels
        const num_dbfs_markers = height / 50;
        let dbfs_markers_step = (gain + dB_range) / num_dbfs_markers;
        // round to 3
        dbfs_markers_step = Math.round(dbfs_markers_step / 3) * 3;
        if (dbfs_markers_step < 1.0) dbfs_markers_step = 1.0;

        dbfsCtx.fillStyle = this.theme.rampFill;
        for (let d = gain; d < gain + dB_range; d += dbfs_markers_step) {
            if (d >= gain + dB_range - dbfs_markers_step)
                d = gain + dB_range;
            const y = rampTop + rampHeight * (d - gain) / dB_range;
            dbfsCtx.fillRect(30, y, 5, 1);
            let y1 = y + font_y / 2 - 1; // adjust the sign to line up
            //if (d <= gain)
            //    y1 = y + 3 * font_y / 2; // push first label down
            //else if (d >= gain + dB_range)
            //    y1 = y - font_y / 2; // pull last label up
            dbfsCtx.fillText((-d).toFixed(0), 11, y1);
        }
    }

    /** Prints color histogram. */
    drawHistograms(c_hist, cB_hist) {
        const histWidth = this.histWidth;
        const histLeft = this.opts.histLeft;
        if (!histWidth) return;

        const height = this.height || this.fftN;
        const cmap = this.cmap;
        const color_max = cmap.length - 1;

        const dbfsCanvas = this.parent.getElementsByClassName('dbfs')[0];
        const dbfsCtx = dbfsCanvas.getContext('2d');

        const rampHeight = height;
        const rampTop = this.opts.rampTop;

        //console.log(c_hist);
        let c_hist_max = 0;

        dbfsCtx.lineWidth = this.theme.histoLine;
        dbfsCtx.strokeStyle = this.theme.histoStroke;
        dbfsCtx.fillStyle = this.theme.histoFill;
        dbfsCtx.beginPath();
        dbfsCtx.moveTo(histLeft, rampTop);
        for (let i = 0; i <= color_max; ++i)
            if (c_hist[i] > c_hist_max) c_hist_max = c_hist[i];
        // console.log(`c_hist_max = ${c_hist_max}`);
        for (let y = 0; y < rampHeight; ++y) {
            let i = color_max - Math.round(y * color_max / (rampHeight - 1));
            let h = histWidth * c_hist[i] / c_hist_max;
            //int h1 = i == 0 ? histWidth * c_hist[1] / c_hist_max : histWidth * c_hist[i - 1] / c_hist_max;
            //dbfsCtx.fillStyle = 'rgba(191,0,0,0.1)';
            //dbfsCtx.fillRect(histLeft, rampTop + y, h, 1);
            //dbfsCtx.fillStyle = `rgb(${55 + 20 * (10 - h)},0,0)`;
            //dbfsCtx.fillRect(histLeft + h - 1, rampTop + y, 1, 1);
            dbfsCtx.lineTo(histLeft + h, rampTop + y);
        }
        dbfsCtx.lineTo(histLeft, rampTop + rampHeight);
        //dbfsCtx.closePath();
        dbfsCtx.fill();
        dbfsCtx.stroke();

        // print dB histogram
        const cB_hist_size = cB_hist.length
        let cB_hist_max = 0;
        let cB_hist_mean = 0;
        for (let i = 0; i < cB_hist_size; ++i) {
            if (cB_hist[i] > cB_hist_max)
                cB_hist_max = cB_hist[i];
            cB_hist_mean += cB_hist[i] / cB_hist_size;
        }
        // console.log(`cB_hist_mean = ${cB_hist_mean}`);

        dbfsCtx.lineWidth = this.theme.dbfsLine;
        dbfsCtx.strokeStyle = this.theme.dbfsStroke;
        dbfsCtx.fillStyle = this.theme.dbfsFill;
        dbfsCtx.beginPath();
        dbfsCtx.moveTo(histLeft, rampTop);
        for (let y = 0; y < rampHeight; ++y) {
            const i = Math.round(y * (cB_hist_size - 1) / (rampHeight - 1));
            const h = histWidth * cB_hist[i] / cB_hist_max;
            //int h1 = i == 0 ? histWidth * cB_hist[1] / cB_hist_max : histWidth * cB_hist[i - 1] / cB_hist_max;
            //dbfsCtx.fillStyle = 'rgba(0,191,0,0.1)';
            //dbfsCtx.fillRect(histLeft, rampTop + y, h, 1);
            //dbfsCtx.fillStyle = `rgb(0,${55 + 20 * (10 - h)},0)`;
            //dbfsCtx.fillRect(histLeft + h - 1, rampTop + y, 1, 1);
            dbfsCtx.lineTo(histLeft + h, rampTop + y);
        }
        dbfsCtx.lineTo(histLeft, rampTop + rampHeight);
        //dbfsCtx.closePath();
        dbfsCtx.fill();
        dbfsCtx.stroke();
    }

    drawAxes() {
        if (this.turnFlip) {
            this.drawWaterfallLeftAxis()
            this.drawWaterfallBottomAxis()
            this.updateGuides()
        } else {
            this.drawSpectrogramLeftAxis()
            this.drawSpectrogramBottomAxis()
            this.updateGuides()
        }
    }

    drawSpectrogramLeftAxis() {
        const height = this.height || this.fftN;

        const quantity = 'f'
        const unit = 'Hz'

        const center_freq = this.center_freq;
        const sample_rate = this.sample_rate;

        // draw y-axis
        const width = this.opts.freqWidth;
        const canvas = this.parent.getElementsByClassName('freq')[0];
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = canvas.width + 'px';
        canvas.parentNode.style.width = canvas.width + 'px';
        //canvas.style.height = canvas.height + 'px';
        const ctx = canvas.getContext('2d');
        ctx.font = '10px sans-serif';
        const fontY = 10;

        const min_spacing = 16;
        const max_ticks = ~~((height / 2 / min_spacing));
        const { major_step, minor_step } = autostep(sample_rate / 2, max_ticks);
        const pixel_per_hz = (height / 2) / (sample_rate / 2);
        const freq_scale = autorange(center_freq + sample_rate, 10.0);
        const lower_hz = center_freq - (sample_rate / 2)
        const upper_hz = center_freq + (sample_rate / 2)
        const lower_major = ~~(lower_hz / major_step) * major_step; // might be offscreen

        ctx.fillStyle = this.theme.freqLabelFill;
        ctx.fillText(`${quantity}[${freq_scale.prefix}${unit}]`, 6, fontY - 1);

        ctx.fillStyle = this.theme.freqMinorFill;
        for (let j = lower_major; j <= upper_hz; j += minor_step) {
            const y = ~~(height / 2 - (j - center_freq) * pixel_per_hz);
            ctx.fillRect(width - 5, y - 1, 5, 1);
        }

        ctx.fillStyle = this.theme.freqMajorFill;
        for (let j = lower_major; j <= upper_hz; j += major_step) {
            const y = ~~(height / 2 - (j - center_freq) * pixel_per_hz);
            ctx.fillRect(width - 10, y - 1, 10, 1);

            if (y < fontY || y > height - fontY)
                continue;
            const y1 = y + fontY - 2;
            const scaleHz = j / freq_scale.scale;
            if (this.channelMode)
                ctx.fillText(Math.abs(scaleHz).toFixed(2), 0, y1);
            else if (center_freq)
                ctx.fillText(scaleHz.toFixed(3), 0, y1);
            else
                ctx.fillText(scaleHz.toFixed(2), 0, y1);
        }

        ctx.fillStyle = this.theme.freqMarkerFill;
        const marker_pos = 0; // Hz rel to center_freq
        if (marker_pos !== null) {
            const y = ~~(height / 2 - marker_pos * pixel_per_hz);
            ctx.fillRect(width - 10, y - 1, 10, 1);
        }

        this.freq_scale = freq_scale;
    }

    drawSpectrogramBottomAxis() {
        const width = this.width;

        const quantity = 't'
        const unit = 's'

        const sample_rate = this.sample_rate;
        const sampleCount = this.sampleCount || this.sampleView.sampleCount;

        // draw x-axis
        const height = this.opts.timeHeight;
        const canvas = this.parent.getElementsByClassName('time')[0];
        canvas.width = width;
        canvas.height = height;
        //canvas.style.width = canvas.width;
        //canvas.style.height = canvas.height;
        const ctx = canvas.getContext('2d');
        ctx.font = '10px sans-serif';
        const fontX = ctx.measureText('8').width;

        const time_scale = autorange(this.wf_metadata.total_time, 10.0);
        const total_time_scaled = this.wf_metadata.total_time / time_scale.scale;
        const pixel_per_time = width / total_time_scaled;
        const min_spacing = 75; // a time marker at most every 75 pixels
        const max_ticks = width / min_spacing;
        const { major_step, minor_step } = autostep(total_time_scaled, max_ticks);

        ctx.fillStyle = this.theme.timeLabelFill;
        ctx.fillText(`${quantity}[${time_scale.prefix}${unit}]`, 32, 18);

        ctx.fillStyle = this.theme.timeMinorFill;
        for (let t = 0; t * minor_step < total_time_scaled; ++t) {
            const x = ~~(t * minor_step * pixel_per_time);
            const tick_size = (t % 5) ? 5 : 10;
            ctx.fillRect(x, 0, 1, tick_size);
        }

        ctx.fillStyle = this.theme.timeMajorFill;
        for (let t = 0.0; t < total_time_scaled; t += major_step) {
            // make last step the non-rounded end
            if (t >= total_time_scaled - major_step)
                t = total_time_scaled;
            const x = ~~(t * pixel_per_time);
            ctx.fillRect(x, 0, 1, 10);

            let x1 = x + 3;
            if (t >= total_time_scaled)
                x1 = x - 6 * fontX;
            //ctx.fillText(`${t.toFixed(0)}${time_scale.prefix}s`, x1, 18);
            ctx.fillText(t.toFixed(0), x1, 16);
        }

        this.time_scale = time_scale;
    }

    drawOverlay() {
        // UNTESTED!
        const canvas = this.parent.getElementsByClassName('fft')[0];
        const ctx = canvas.getContext('2d');

        var calcDopplerFactor = function(t) {
            const beta = this.doppler.getDopplerFactor(t);

            const f = obsMetadata.frequency * (1 + beta); // Hz
            return canvas.width/2 + obsMetadata.frequency * beta * canvas.width / this.sample_rate;
        };

        ctx.lineWidth = this.theme.overlayLine;
        ctx.strokeStyle = this.theme.overlayStroke;
        ctx.setLineDash([]);

        const N = 10;
        let t = new Date(start_time);
        const dt = this.wf_metadata.total_time / N; // in seconds

        ctx.beginPath();
        ctx.moveTo(calcDopplerFactor(t), canvas.height);
        for (let i = 0; i <= N; ++i) {
            t = new Date(t.getTime() + 1000 * dt);
            ctx.lineTo(calcDopplerFactor(t), canvas.height - i/N * canvas.height);
        }
        ctx.stroke();
    }

    drawWaterfallLeftAxis() {
        const height = this.width; // ???

        const quantity = 't'
        const unit = 's'

        const sample_rate = this.sample_rate;
        const sampleCount = this.sampleCount || this.sampleView.sampleCount;

        // draw y-axis
        const width = this.opts.freqWidth;
        const canvas = this.parent.getElementsByClassName('freq')[0];
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = canvas.width + 'px';
        canvas.parentNode.style.width = canvas.width + 'px';
        //canvas.style.height = canvas.height + 'px';
        const ctx = canvas.getContext('2d');
        ctx.font = '10px sans-serif';
        const fontY = 10;

        const time_scale = autorange(this.wf_metadata.total_time, 10.0);
        const total_time_scaled = this.wf_metadata.total_time / time_scale.scale;
        const pixel_per_time = height / total_time_scaled;
        const min_spacing = 32; // a time marker at most every 32 pixels
        const max_ticks = height / min_spacing;
        const { major_step, minor_step } = autostep(total_time_scaled, max_ticks);

        ctx.fillStyle = this.theme.freqLabelFill;
        ctx.fillText(`${quantity}[${time_scale.prefix}${unit}]`, 6, fontY - 1);

        ctx.textAlign = 'right';

        ctx.fillStyle = this.theme.freqMinorFill;
        for (let t = 0; t * minor_step < total_time_scaled; ++t) {
            const y = height - ~~(t * minor_step * pixel_per_time);
            const tick_size = (t % 5) ? 5 : 10;
            ctx.fillRect(width - tick_size, y - 1, tick_size, 1);
        }

        ctx.fillStyle = this.theme.freqMajorFill;
        for (let t = 0.0; t < total_time_scaled; t += major_step) {
            // make last step the non-rounded end
            if (t >= total_time_scaled - major_step)
                t = total_time_scaled;
            const y = height - ~~(t * pixel_per_time);
            ctx.fillRect(width - 10, y - 1, 10, 1);

            let y1 = y - 2;
            if (t >= total_time_scaled)
                y1 = y + 2 * fontY;
            ctx.fillText(t.toFixed(0), width - 10, y1);
        }

        this.time_scale = time_scale;
    }

    drawWaterfallBottomAxis() {
        const width = this.height || this.fftN;

        const quantity = 'f'
        const unit = 'Hz'

        const center_freq = this.center_freq;
        const sample_rate = this.sample_rate;

        // draw x-axis
        const height = this.opts.timeHeight;
        const canvas = this.parent.getElementsByClassName('time')[0];
        canvas.width = width;
        canvas.height = height;
        //canvas.style.width = canvas.width;
        //canvas.style.height = canvas.height;
        const ctx = canvas.getContext('2d');
        ctx.font = '10px sans-serif';
        const fontX = ctx.measureText('8').width;

        const min_spacing = 48;
        const max_ticks = ~~((width / 2 / min_spacing));
        const { major_step, minor_step } = autostep(sample_rate / 2, max_ticks);
        const pixel_per_hz = (width / 2) / (sample_rate / 2);
        const freq_scale = autorange(center_freq + sample_rate, 10.0);
        const lower_hz = center_freq - (sample_rate / 2)
        const upper_hz = center_freq + (sample_rate / 2)
        const lower_major = ~~(lower_hz / major_step) * major_step; // might be offscreen

        ctx.fillStyle = this.theme.timeLabelFill;
        ctx.fillText(`${quantity}[${freq_scale.prefix}${unit}]`, 10, 10);

        ctx.textAlign = 'center';

        ctx.fillStyle = this.theme.timeMinorFill;
        for (let j = lower_major; j <= upper_hz; j += minor_step) {
            const x = ~~(width / 2 + (j - center_freq) * pixel_per_hz);
            ctx.fillRect(x, 0, 1, 5);
        }

        ctx.fillStyle = this.theme.timeMajorFill;
        for (let j = lower_major; j <= upper_hz; j += major_step) {
            const x = ~~(width / 2 + (j - center_freq) * pixel_per_hz);
            ctx.fillRect(x, 0, 1, 10);

            const scaleHz = j / freq_scale.scale;
            let x1 = x + 0;
            if (x1 > 0 && x1 < 4 * fontX)
                x1 = 4 * fontX;
            if (x1 > width - 3 * fontX)
                x1 = width - 3 * fontX;
            if (this.channelMode)
                ctx.fillText(Math.abs(scaleHz).toFixed(2), x1, 16);
            else if (center_freq)
                ctx.fillText(scaleHz.toFixed(3), x1, 16);
            else
                ctx.fillText(scaleHz.toFixed(2), x1, 16);
        }

        ctx.fillStyle = this.theme.freqMarkerFill;
        const marker_pos = 0; // Hz rel to center_freq
        if (marker_pos !== null) {
            const x = ~~(width / 2 + marker_pos * pixel_per_hz);
            ctx.fillRect(x, 0, 1, 10);
        }

        this.freq_scale = freq_scale;
    }

    updateGuides() {
        // TODO: var names are confusing
        const width = this.turnFlip ? this.height || this.fftN : this.width;
        const height = this.turnFlip ? this.width : this.height || this.fftN;
        const timeHeight = this.opts.timeHeight;

        const guides = this.parent.getElementsByClassName('guides')[0];
        guides.style.width = width + 'px';
        guides.style.height = (height + timeHeight + this.ampHeight + this.minmaxHeight) + 'px';

        const center_freq = this.center_freq;
        const sample_rate = this.sample_rate;
        const sampleCount = this.sampleCount || this.sampleView.sampleCount;

        this.hz_per_pixel = sample_rate / (this.height || this.fftN);
        this.hz_offset = center_freq - sample_rate / 2;
        this.time_per_pixel = sampleCount / sample_rate / this.width;

        // console.log({
        //     center_freq,
        //     sample_rate,
        //     sampleCount,
        //     hz_per_pixel: this.hz_per_pixel,
        //     hz_offset: this.hz_offset,
        //     time_per_pixel: this.time_per_pixel,
        // });
    }

    drawGuides(x, y) {
        if (!this.hz_per_pixel || !this.hz_offset || !this.freq_scale || !this.time_per_pixel || !this.time_scale) return

        const width = this.turnFlip ? this.height || this.fftN : this.width;
        const height = this.turnFlip ? this.width : this.height || this.fftN;
        const timeHeight = this.opts.timeHeight;
        const fullHeight = (height + timeHeight + this.ampHeight + this.minmaxHeight);

        const guidesCanvas = this.parent.getElementsByClassName('guides')[0];
        guidesCanvas.width = width;
        guidesCanvas.height = fullHeight;
        const ctx = guidesCanvas.getContext('2d');
        ctx.font = '14px sans-serif';

        //ctx.globalCompositeOperation = 'xor';

        ctx.fillStyle = this.theme.guidesBgFill;
        ctx.fillRect(x - 2, 0, 3, height);
        ctx.fillRect(0, y - 2, width, 3);
        if (this.isDrag) {
            ctx.fillStyle = this.theme.guidesDragFill;
            ctx.fillRect(this.dragX + 1, 0, x - this.dragX, height);
        }

        ctx.strokeStyle = this.theme.guidesHairStroke;
        ctx.setLineDash([1, 1]);

        ctx.beginPath();
        ctx.moveTo(x - 0.5, 0);
        ctx.lineTo(x - 0.5, height);
        ctx.moveTo(0, y - 0.5);
        ctx.lineTo(width, y - 0.5);
        ctx.stroke();

        let f;
        let t;
        if (this.turnFlip) {
            const y1 = height - y; // Y is inverted
            f = (x * this.hz_per_pixel + this.hz_offset) / this.freq_scale.scale;
            t = (this.isDrag ? y1 - this.dragY : y1) * this.time_per_pixel / this.time_scale.scale;
        } else {
            const y1 = height - y; // Y is inverted
            f = (y1 * this.hz_per_pixel + this.hz_offset) / this.freq_scale.scale;
            t = (this.isDrag ? x - this.dragX : x) * this.time_per_pixel / this.time_scale.scale;
        }
        const text = `f: ${f.toFixed(3)} ${this.freq_scale.prefix}Hz, t: ${t.toFixed(this.isDrag ? 4 : 1)} ${this.time_scale.prefix}s`;

        // TODO: this should have a hysteresis
        const xOffset = x < width / 2 ? 8 : -190;
        const yOffset = y < height / 2 ? 8 : -22;

        ctx.fillStyle = this.theme.guidesInfoBgFill;
        ctx.fillRect(x + xOffset, y + yOffset, 180, 14);
        ctx.fillStyle = this.theme.guidesInfoTextFill;
        ctx.fillText(text, x + xOffset + 4, y + yOffset + 12);
    }

    processData() {
        if (!this.buffer) return Promise.resolve();
        if (this.hdf5_file) {
            return this.processHDF5Data();
        } else {
            return this.processDefaultData();
        }
    }

    processHDF5Data() {

        if (this.hdf5_file.attrs["artifact_version"] < 2) {
            console.log("ERROR: Unsupported artifacts version.");
            return;
        }

        if ("metadata" in this.hdf5_file.attrs) {
            this.obs_metadata = JSON.parse(this.hdf5_file.attrs["metadata"]);
        } else if ("metadata" in wf_group) {
            this.obs_metadata = JSON.parse(wf_group.attrs["metadata"]);
        } else {
            console.log("ERROR: Malformed artifact.");
            return;
        }

        const wf_group = this.hdf5_file.get('waterfall');

        this.wf_metadata = {
            start_time: new Date(wf_group.attrs['start_time']),
            total_time: this.sampleCount / this.sample_rate,
        };


        // console.time('h5 overall ' + this.tag);
        const wf_offset = wf_group.get('offset');
        const wf_scale = wf_group.get('scale');
        const wf_data = wf_group.get('data');
        const wf_frequency = wf_group.get('frequency');
        const wf_relative_time = wf_group.get('relative_time');
        const wf_absolute_time = wf_group.get('absolute_time');

        // console.time('h5 get offset_value ' + this.tag);
        const wf_offset_value = wf_offset.value;
        // console.timeEnd('h5 get offset_value ' + this.tag);

        // console.time('h5 get scale_value ' + this.tag);
        const wf_scale_value = wf_scale.value;
        // console.timeEnd('h5 get scale_value ' + this.tag);

        // console.time('h5 get data_value ' + this.tag);
        if (!this.wf_data_value)
            this.wf_data_value = wf_data.value; // NOTE: this is extremly heavy load
        const wf_data_value = this.wf_data_value;
        // console.timeEnd('h5 get data_value ' + this.tag);

        // console.time('h5 process ' + this.tag);
        const fftCanvas = this.parent.getElementsByClassName('fft')[0];
        const fftCtx = fftCanvas.getContext('2d'); // TODO: { alpha: false }
        const width = wf_data.shape[1];
        // window.innerHeight * this.zoom - extraWidth;
        const stride = 9 - this.zoom;
        const height = ~~(wf_data.shape[0] / stride);

        // save scroll offset
        const scrollElX = this.parent.getElementsByClassName('scroll')[0];
        const scrollElY = this.scrollElY;
        const scrollPctX = scrollElX.scrollLeftMax ? scrollElX.scrollLeft / scrollElX.scrollLeftMax : 0
        const oldSize = { width: fftCanvas.width, height: fftCanvas.height }
        let zoomPoint = this.zoomPoint;
        this.zoomPoint = null;
        if (zoomPoint) {
            // x/y pct appears at scrollX/Y in the el
            zoomPoint.x = zoomPoint.offsetX / fftCanvas.width;
            zoomPoint.y = zoomPoint.offsetY / fftCanvas.height;
            zoomPoint.scrollX = zoomPoint.offsetX - scrollElX.scrollLeft;
            zoomPoint.scrollY = zoomPoint.offsetY - scrollElY.scrollTop;
        }

        fftCanvas.width = width;
        fftCanvas.height = height;

        const minmaxCanvas = this.parent.getElementsByClassName('minmax')[0];
        minmaxCanvas.width = 0;
        minmaxCanvas.height = 0;

        const ampCanvas = this.parent.getElementsByClassName('amp')[0];
        ampCanvas.width = 0;
        ampCanvas.height = 0;

        // restore scroll offset
        if (zoomPoint) {
            // note: scrollElX.scrollWidth isn't updated yet, use fftCanvas.width as approx
            scrollElX.scrollLeft = zoomPoint.x * fftCanvas.width - zoomPoint.scrollX

            // scroll Y relative by the change in our height, can ignore other elements height
            const deltaHeight = fftCanvas.height - oldSize.height
            scrollElY.scrollTop += deltaHeight * zoomPoint.y;
        } else {
            scrollElX.scrollLeft = scrollPctX * scrollElX.scrollLeftMax;

            // scroll Y relative by the change in our height, can ignore other elements height
            const deltaHeight = fftCanvas.height - oldSize.height;
            if (scrollElY.scrollTop)
                scrollElY.scrollTop += deltaHeight * 0.5;
        }

        const imageData = newImageData(width, height);
        const cmap = this.cmap;
        // console.log(`Drawing H5 ${width} x ${height}`)
        const offset_min = this.offset_min;
        const offset_max = this.offset_max;
        //const scale_min = this.scale_min;
        const scale_max = this.scale_max;
        const db_min1 = offset_min;
        const db_max1 = offset_max + scale_max * 255;
        // console.log(`Auto Range: ${db_min1} to ${db_max1}`)
        const db_min = -this.gain - this.range;
        const db_max = -this.gain;
        // console.log(`Range: ${db_min} to ${db_max}`)
        const db_scale = 255 / (db_max - db_min);
        // console.timeEnd('h5 process ' + this.tag);

        // console.time('h5 prescale ' + this.tag);
        // prescaled integer drawing is 15% faster
        const db_min_scaled = db_min * db_scale * 65536;
        let offsets = new Array(width);
        let scales = new Array(width);
        for (let x = 0; x < width; ++x) {
            const offset = wf_offset_value[x];
            const scale = wf_scale_value[x];
            offsets[x] = ~~(offset * db_scale * 65536 - db_min_scaled);
            scales[x] = ~~(scale * db_scale * 65536);
        }
        // console.timeEnd('h5 prescale ' + this.tag);

        // console.time('h5 drawing ' + this.tag);
        // unscaled drawing is 20% faster
        if (this.dynRange) {
            for (let y = 0; y < height; ++y) {
                for (let x = 0; x < width; ++x) {
                    const gray = wf_data_value[y * stride * width + x];
                    const color = cmap[gray];
                    const j = x * 4 + width * (height - y) * 4;
                    imageData.data[j + 0] = color[0]; // R
                    imageData.data[j + 1] = color[1]; // G
                    imageData.data[j + 2] = color[2]; // B
                    imageData.data[j + 3] = 255; // A
                }
            }
        }
        else {
            for (let y = 0; y < height; ++y) {
                for (let x = 0; x < width; ++x) {
                    //const offset = wf_offset_value[x];
                    //const scale = wf_scale_value[x];
                    const offset = offsets[x];
                    const scale = scales[x];
                    // const data = wf_data_value[y * stride * width + x]; // naive stride
                    let data = 0; // average over stride
                    for (let j = 0; j < stride; ++j) {
                        data += wf_data_value[(y * stride + j) * width + x];
                    }
                    data = data / stride;
                    //const gray = (data * scale + offset - db_min_scaled) * db_scale
                    const gray1 = (data * scale + offset) >> 16;
                    const gray = gray1 < 0 ? 0 : gray1 > 255 ? 255 : gray1
                    //const color = cmap[~~gray];
                    const color = cmap[gray];
                    const j = x * 4 + width * (height - y) * 4;
                    imageData.data[j + 0] = color[0]; // R
                    imageData.data[j + 1] = color[1]; // G
                    imageData.data[j + 2] = color[2]; // B
                    imageData.data[j + 3] = 255; // A
                }
            }
        }
        // console.timeEnd('h5 drawing ' + this.tag);

        // console.time('h5 putting ' + this.tag);
        fftCtx.putImageData(imageData, 0, 0);
        // console.timeEnd('h5 putting ' + this.tag);

        // console.timeEnd('h5 overall ' + this.tag);

        //this.gain = ~~(-db_max)
        //this.range = ~~(db_max - db_min)
        this.drawColorRamp();

        const wf_frequency_value = wf_frequency.value; // note: unit is Hz
        const wf_absolute_time_value = wf_absolute_time.value; // note: unit is us
        const wf_relative_time_value = wf_relative_time.value; // note: unit is s

        // wf_absolute_time_value0: 134703
        // wf_absolute_time_value1: 200745
        // wf_absolute_time_valueN: 510 087 172
        // wf_relative_time_value0: 0
        // wf_relative_time_value1: 0.08533333333333333
        // wf_relative_time_valueN: 509.952

        const btm_freq = wf_frequency_value[0];
        const center_freq = wf_frequency_value[~~(wf_frequency_value.length / 2)];
        const top_freq = wf_frequency_value[wf_frequency_value.length - 1];
        // this.center_freq = (btm_freq + top_freq) / 2;

        this.center_freq = center_freq;
        this.sample_rate = top_freq - btm_freq;
        this.sampleCount = wf_relative_time_value[wf_relative_time_value.length - 1] * this.sample_rate;

        //const stride1 = this.sampleCount / wf_data.shape[0];
        // console.log({
        //     stride1,
        //     btm_freq,
        //     top_freq,
        //     center_freq: this.center_freq,
        //     sample_rate: this.sample_rate,
        //     sampleCount: this.sampleCount,
        //     wf_relative_time_valueN: wf_relative_time_value[wf_relative_time_value.length - 1],
        //     wf_absolute_time_valueN: wf_absolute_time_value[wf_absolute_time_value.length - 1],
        // })

        // force some options
        this.turnFlip = true;
        this.ampHeight = 0;
        this.minmaxHeight = 0;

        this.fftN = wf_data.shape[1];
        this.height = wf_data.shape[1];
        this.width = height;

        // Initalize doppler model
        this.doppler = new DopplerModel(this.obs_metadata.tle.split("\n").slice(1, 3),
                                        {longitude: this.obs_metadata.location.longitude,
                                         latitude: this.obs_metadata.location.latitude,
                                         height: this.obs_metadata.location.altitude},
                                        this.wf_metadata.start_time);

        this.drawAxes();
        //this.drawOverlay();

        return Promise.resolve();
    }

    processDefaultData() {
        if (!this.sampleView || !this.sampleView.buffer) return Promise.resolve();
        if (this.inProcess) return this.inProcess

        // console.time('fft process ' + this.tag);
        const waterfall = this.turnFlip
        const extraWidth = this.opts.freqWidth + this.opts.dbfsWidth + this.histWidth;
        this.width = (waterfall ? window.innerHeight : this.parent.clientWidth) * this.zoom - extraWidth;

        const sampleFormat = this.sampleView.format;
        const sampleWidth = this.sampleView.sampleWidth;
        const sampleCount = this.sampleView.sampleCount;

        //const center_freq = this.center_freq;
        //const sample_rate = this.sample_rate;

        const n = this.fftN;
        const { window: windowc, weight } = this.windowF(n); // blackmanHarrisWindow(n);
        //const block_norm = 1.0 / n;
        const block_norm = 1.0 / weight;
        const block_norm_db = 10 * Math.log10(block_norm);
        // console.log(`block_norm=${n}, ${block_norm_db} dB, window weight=${weight}`);

        // cu8 has a possible range of 0 to -60 dBfs
        const gain = this.gain;
        const dB_range = this.range;

        this.dBfs_min = 0.0;
        this.dBfs_max = -200.0;

        const cmap = this.cmap;
        // OOB colors?
        cmap[0] = [0, 0, 0];
        cmap[cmap.length - 1] = [255, 255, 255];
        const color_norm = cmap.length / -dB_range;
        // console.log(`colors=${cmap.length}, color_norm=${color_norm}`);

        const cB_hist_size = 1000; // centi Bell (0.1 dB)
        const cB_hist = new Array(cB_hist_size).fill(0); // -0.0 to -100.0 dB
        const c_hist = new Array(cmap.length).fill(0);

        //const stride = 128;
        //const width = Math.floor((sampleCount - n) / stride);
        const width = this.width;
        const points = width;
        const stride = (sampleCount - n) / (points - 1);
        // console.log(`samples=${sampleCount} / stride=${stride}`);

        const height = n;
        // console.log(`width=${width} height=${height}`);

        const fftCanvas = this.parent.getElementsByClassName('fft')[0];

        // save zoom approx
        const fftCtx = fftCanvas.getContext('2d'); // TODO: { alpha: false }
        const oldImageData = fftCtx.getImageData(0, 0, fftCanvas.width, fftCanvas.height)
        const imageBitmapPromise = createImageBitmap(oldImageData) // mostly unsupported

        // save scroll offset
        const scrollElX = this.parent.getElementsByClassName('scroll')[0];
        const scrollElY = this.scrollElY
        const scrollPctX = scrollElX.scrollLeftMax ? scrollElX.scrollLeft / scrollElX.scrollLeftMax : 0
        const oldSize = { width: fftCanvas.width, height: fftCanvas.height }
        let zoomPoint = this.zoomPoint
        this.zoomPoint = null
        if (zoomPoint) {
            // x/y pct appears at scrollX/Y in the el
            zoomPoint.x = zoomPoint.offsetX / fftCanvas.width
            zoomPoint.y = zoomPoint.offsetY / fftCanvas.height
            zoomPoint.scrollX = zoomPoint.offsetX - scrollElX.scrollLeft
            zoomPoint.scrollY = zoomPoint.offsetY - scrollElY.scrollTop
        }

        fftCanvas.width = waterfall ? height : width;
        fftCanvas.height = waterfall ? width : height;

        imageBitmapPromise.then(image => fftCtx.drawImage(image, 0, 0, fftCanvas.width, fftCanvas.height)) // restore zoom approx
        if (this.height) {
            fftCanvas.style.height = (waterfall ? width : this.height) + 'px';
            fftCanvas.style.width = (waterfall ? this.height : width) + 'px';
        } else { // 0 = auto
            fftCanvas.style.height = '';
            fftCanvas.style.width = '';
        }

        const minmaxCanvas = this.parent.getElementsByClassName('minmax')[0];
        minmaxCanvas.width = width;
        minmaxCanvas.height = this.minmaxHeight;

        const ampCanvas = this.parent.getElementsByClassName('amp')[0];
        ampCanvas.width = width;
        ampCanvas.height = this.ampHeight;

        // restore scroll offset
        if (zoomPoint) {
            // note: scrollElX.scrollWidth isn't updated yet, use fftCanvas.width as approx
            scrollElX.scrollLeft = zoomPoint.x * fftCanvas.width - zoomPoint.scrollX
            // scroll Y relative by the change in our height, can ignore other elements height
            const deltaHeight = fftCanvas.height - oldSize.height
            scrollElY.scrollTop += deltaHeight * zoomPoint.y
        } else {
            scrollElX.scrollLeft = scrollPctX * scrollElX.scrollLeftMax
            // scroll Y relative by the change in our height, can ignore other elements height
            const deltaHeight = fftCanvas.height - oldSize.height
            if (scrollElY.scrollTop)
                scrollElY.scrollTop += deltaHeight * 0.5
        }

        // console.time('fft render ' + this.tag);
        const indexed = false
        const startSample = 0; // ~~(this.buffer.byteLength / 4);
        const endSample = ~~(this.buffer.byteLength / sampleWidth); // 16 * 5); // TODO: should be this.sampleView.buffer?
        const sliceWidth = ~~(width / renderWorkerCount);
        let renders = []
        for (let i = 0; i < renderWorkerCount; ++i) {
            const bufferSlice = this.sampleView.slice(i, renderWorkerCount, startSample, endSample);

            const fftCtx = {
                block_norm: block_norm,
                gain: gain,
                range: dB_range,
                cmap: cmap,
                n: n,
                windowc: windowc,
                width: sliceWidth,
                offset: i * sliceWidth,
                buffer: bufferSlice,
                format: sampleFormat,
                channelMode: this.channelMode,
                indexed: indexed,
                waterfall: waterfall,
            };

            const promise = renderPromise(i, fftCtx, [bufferSlice])
            .then(msg => {
                if (msg.data.dBfs_min < this.dBfs_min) this.dBfs_min = msg.data.dBfs_min;
                if (msg.data.dBfs_max > this.dBfs_max) this.dBfs_max = msg.data.dBfs_max;

                for (let x = 0; x < cB_hist_size; x++) {
                    cB_hist[x] += msg.data.cB_hist[x];
                }
                for (let x = 0; x < this.cmap.length; x++) {
                    c_hist[x] += msg.data.c_hist[x];
                }

                //console.log(`Slice draw: ${sliceWidth} x ${height} to ${msg.data.offset}`);
                // console.time('draw slice ' + this.tag);
                // const image = msg.data.imageData; // would need polyfill in worker
                let image
                if (indexed) {
                    image = newImageData(sliceWidth, height);
                    for (let y = 0; y < height; ++y) {
                        for (let x = 0; x < sliceWidth; ++x) {
                            const gray = msg.data.imageData.data[y * sliceWidth + x]
                            const color = cmap[gray];
                            const j = x * 4 + sliceWidth * y * 4;
                            image.data[j + 0] = color[0]; // R
                            image.data[j + 1] = color[1]; // G
                            image.data[j + 2] = color[2]; // B
                            image.data[j + 3] = 255; // A
                        }
                    }
                } else {
                    image = newImageData(msg.data.imageData.data, waterfall ? height : sliceWidth);
                }

                //const fftCanvas = this.parent.getElementsByClassName('fft')[0];
                const fftCtx = fftCanvas.getContext('2d'); // TODO: { alpha: false }
                fftCtx.putImageData(image, waterfall ? 0 : msg.data.offset, waterfall ? width - sliceWidth - msg.data.offset : 0);
                // console.timeEnd('draw slice ' + this.tag);

                //const ampCanvas = this.parent.getElementsByClassName('amp')[0];
                const ampCtx = ampCanvas.getContext('2d');
                const ampScale = this.ampHeight / 256;
                //const minmaxCanvas = this.parent.getElementsByClassName('minmax')[0];
                const minmaxCtx = minmaxCanvas.getContext('2d');
                const minmaxScale = this.minmaxHeight / 256;
                for (let x = 0; x < sliceWidth; x++) {
                    const g_min = msg.data.gauge_mins[x];
                    const g_max = msg.data.gauge_maxs[x];
                    const g_amp = msg.data.gauge_amps[x];
                    if (this.minmaxHeight) {
                        minmaxCtx.fillStyle = `rgb(${255 - g_max},${255 - g_max},${255 - g_max})`;
                        //const c = cmap[g_max];
                        //minmaxCtx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
                        minmaxCtx.fillRect(x + msg.data.offset, ~~(g_min * minmaxScale), 1, ~~((g_max - g_min) * minmaxScale));
                    }
                    if (this.ampHeight) {
                        ampCtx.fillStyle = `rgb(${255 - g_max},${255 - g_max},${255 - g_max})`;
                        //const c = cmap[g_max];
                        //ampCtx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
                        ampCtx.fillRect(x + msg.data.offset, 0, 1, ~~(g_amp * ampScale));
                    }
                }
            });
            renders.push(promise);
        }

        this.drawColorRamp();
        this.drawAxes();
        // console.timeEnd('fft process ' + this.tag);

        this.inProcess = Promise.all(renders)
        .then(() => {
            // console.timeEnd('fft render ' + this.tag);
            this.buildInfo();
            this.drawHistograms(c_hist, cB_hist);
            this.inProcess = false
        });
        return this.inProcess
    }

    createDropZone(elementOrSelector) {
        elementOrSelector = elementOrSelector || this.parent.getElementsByClassName('dropzone')[0];
        const fileLoader = this.setData.bind(this);
        this.dropZone = new DropZone(elementOrSelector, fileLoader)
    }

    // events

    handleEvent(e) {
        //console.log(e.type)
        const handler = e.type
        if (typeof this[handler] === 'function') {
            return this[handler](e);
        }
    }

    debouncedResize() {
        this.processData()
    }

    wheel(e) {
        if (!e.deltaMode) {
            return; // can't handle this
        }
        if (e.ctrlKey || e.altKey || e.metaKey) {
            e.preventDefault();
            if (this.inProcess) {
                //console.log('Zoom denied');
                return; // denied.
            }
            if (e.deltaY > 0 || e.deltaX > 0 || e.deltaZ > 0) {
                //console.log('Zoom out');
                if (this.zoom <= 1) return;
                this.zoom -= 0.5;
            } else {
                //console.log('Zoom in');
                if (this.zoom >= 8) return;
                this.zoom += 0.5;
            }
            const clientRect = e.target.getBoundingClientRect();
            const offsetX = e.clientX - clientRect.left;
            const offsetY = e.clientY - clientRect.top;
            this.zoomPoint = { offsetX, offsetY };

            this.processData()
        }
    }

    mousedown(e) {
        this.dragX = e.offsetX;
        this.dragY = e.offsetY;
        this.isDrag = true;
        e.preventDefault();
    }

    mouseup(e) {
        this.isDrag = false;
        e.preventDefault();
    }

    mousemove(e) {
        window.requestAnimationFrame(this.drawGuides.bind(this, e.offsetX, e.offsetY));
        e.stopPropagation();
        e.preventDefault();
    }

    touchstart(e) {
        // console.log(e);
        // single touch or start of a drag
        // touch events don't have offsetX, offsetY
        const clientRect = e.target.getBoundingClientRect();

        const t = e.targetTouches[0];
        const offsetX = t.clientX - clientRect.left;
        const offsetY = t.clientY - clientRect.top;

        window.requestAnimationFrame(this.drawGuides.bind(this, offsetX, offsetY));

        if (e.targetTouches.length > 1)
            e.preventDefault(); // don't allow multitouches
    }

    touchcancel(e) {
        if (e.targetTouches.length <= 1) {
            this.isDrag = false;
        }
    }

    touchend(e) {
        if (e.targetTouches.length <= 1) {
            this.isDrag = false;
        }
    }

    touchmove(e) {
        // touch events don't have offsetX, offsetY
        const clientRect = e.target.getBoundingClientRect();

        let t1 = e.targetTouches[0];
        if (e.targetTouches.length == 2) {
            // select range
            this.isDrag = true;
            const t2 = e.targetTouches[1];
            if (t1.clientX < t2.clientX) {
                this.dragX = t1.clientX - clientRect.left;
                this.dragY = t1.clientY - clientRect.top;
                t1 = t2;
            } else {
                this.dragX = t2.clientX - clientRect.left;
                this.dragY = t2.clientY - clientRect.top;
            }
            e.preventDefault();
        }

        const offsetX = t1.clientX - clientRect.left;
        const offsetY = t1.clientY - clientRect.top;

        window.requestAnimationFrame(this.drawGuides.bind(this, offsetX, offsetY));

        e.stopPropagation();
    }
}


function fetchArraybuffer(url) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr);
            } else {
                reject(xhr.statusText);
            }
        };
        xhr.onerror = () => reject(xhr.statusText);
        xhr.send(null);
    });
}


/**
    This callback is used to load file data.
    @callback FileLoader
    @param {Object} fileinfo - File info object
*/

export { loadUrl }

/**
    Load data from a URL.

    @param {string} url - URL to load data from
    @param {FileLoader} [fileLoader] - Callback for File info object
    @returns {Object} File info object
*/
function loadUrl(url, fileLoader) {
    url = url || '/bresser_3ch/gfile001.cu8';
    var basename = url.substring(url.lastIndexOf('/') + 1);
    if (!url.startsWith('//') && url.startsWith('/')) {
        basename = url.substring(1);
        url = 'https://cdn.jsdelivr.net/gh/merbanan/rtl_433_tests@latest/tests' + url;
    }

    return fetchArraybuffer(url).then(xhr => {
        var arrayBuffer = xhr.response; // Note: not xhr.responseText
        if (!arrayBuffer) {
            throw new Error('No data!');
        }
        // console.log(xhr.getResponseHeader('Last-Modified'));
        const fileinfo = {
            fileBuffer: arrayBuffer,
            lastModified: xhr.getResponseHeader('Last-Modified'),
            name: basename,
            type: xhr.getResponseHeader('Content-Type'),
            size: arrayBuffer.byteLength,
        };
        if (fileLoader)
            fileLoader(fileinfo);
        return fileinfo;
    });
}
