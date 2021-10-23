# Spectroplot: I/Q Spectrogram Plot JS library.

A library to visualize the I/Q or audio spectrogram of sample data in a HTML canvas.
For an example open https://triq.org/iqs and drop your sample data in.

You can choose the FFT bin number and zoom (x1, x2, x4, x8) with horizontal scrolling.
There is a frequency scale and a time scale, and dB(fs) range,
a histogram of the plotted dB range and the full dB range. You can choose the gain and dB range.
Also an experimental (spark line type) bar with min/max dB per sample.
A cross hair with info on the frequency and time position is available on hover or touch.
There are some windowing functions (Rectangular, Bartlett, Hamming, Hann, Blackman, Blackman-Harris),
and some Colormap (Cube1, Sox, Naive, Viridis, Plasma, Inferno, Magma, Hot, Afmhot, Gist_heat, Parabola) to choose from.

Supported raw SDR data file types are:
- .cu4
- .cs4
- .cu8 (.data .complex16u)
- .cs8 (.complex16s)
- .cu12
- .cs12
- .cu16
- .cs16
- .cu32
- .cs32
- .cu64
- .cs64
- .cf32 (.cfile .complex)
- .cf64

Also supported are (stereo) audio files containing I/Q data (if supported by the browser):
- .wav
- .bwf
- .webm
- .ogg
- .opus
- .flac
- .mp4
- .m4a
- .aac
- .mp3

All comments and suggestions very welcome.

If you like to give feedback:
- Is this useful to you? Why not, what is missing?
- Is this bundled in a useful way? Do you want the lib hosted on a CDN?

## Getting Started
Create the Spectroplot with:

```js
import { Spectroplot } from 'spectroplot'

let spectroplot = new Spectroplot({
    // ...
})
```

You likely want to include some minimal styles, see [`styles.css`](lib/styles.css):
```js
import 'spectroplot/lib/styles.css'
```

## Using the API

There is a simple API which manages a drop zone and creates spectrograms from a template,
see [`example.html`](lib/example.html) for this `new EasyCloning(elementOrSelector)` API.

For more control construct each `new Spectroplot(options)` as needed with custom options.
Then on the instance use `setOption(opt, value)`, `setOptions(opts)`, and `setData(filedata)`.
See [`iqspectrovue`](https://github.com/triq-org/iqspectrovue) for a full featured example using VueJS.

The full API is detailed in [`API.md`](API.md)

## Copyright and Licence

Copyright (C) 2017-2021 Christian W. Zuckschwerdt <zany@triq.net>

Unless otherwise noted all sources are:

License: GPL-2+
