
### chromium-throttle4x

| Image | Mode | Decode | Pre-process | Segment | Fit (compose) | Optimize+validate | SVG | Transfer+parse | WASM call cold / warm | Preview paint | Import→visible | PDF | Anchors | Paths | SVG / PDF size | WASM mem MiB | Max frame gap proc / preview |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| concert-small-venue | bw | 645 | 417 | 216 | 511 | 1 | 12 | 2 | 1,166 / 849 | 53 | 2,098 | 58 | 17,089 | 223 | 656 KB / 238 KB | 357 | 33 / 17 |
| concert-small-venue | color | 650 | 79 | 3,934 | 1,817 | 302 | 286 | 21 | 6,530 / 6,060 | 727 | 8,153 | 1,327 | 424,222 | 28,858 | 16.9 MB / 5.9 MB | 538 | 17 / 667 |
| concert-small-venue | limited | 639 | 133 | 2,640 | 3,415 | 22 | 263 | 18 | 6,655 / 4,452 | 545 | 8,080 | 1,175 | 392,633 | 11,890 | 14.5 MB / 4.9 MB | 566 | 17 / 467 |
| concert-small-venue-1280 | bw | 71 | 29 | 22 | 55 | 1 | 4 | 1 | 112 / 90 | 29 | 422 | 13 | 3,734 | 52 | 123 KB / 48 KB | 44 | 17 / 17 |
| concert-small-venue-1280 | color | 72 | 5 | 434 | 283 | 20 | 59 | 6 | 823 / 775 | 154 | 1,263 | 246 | 87,738 | 5,994 | 3.1 MB / 1.2 MB | 110 | 17 / 117 |
| concert-small-venue-1280 | limited | 71 | 39 | 295 | 227 | 5 | 52 | 5 | 647 / 507 | 117 | 1,046 | 204 | 76,359 | 2,926 | 2.5 MB / 879 KB | 76 | 17 / 83 |

### chromium

| Image | Mode | Decode | Pre-process | Segment | Fit (compose) | Optimize+validate | SVG | Transfer+parse | WASM call cold / warm | Preview paint | Import→visible | PDF | Anchors | Paths | SVG / PDF size | WASM mem MiB | Max frame gap proc / preview |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| portrait-face | bw | 96 | 713 | 210 | 656 | 3 | 40 | 2 | 1,643 / 1,245 | 49 | 2,002 | 195 | 59,397 | 1,504 | 2.2 MB / 719 KB | 478 | 17 / 17 |
| portrait-face | color | Error [too_many_primitives]: output would contain 1153098 primitives, limit is 1000000; increase pitch or reduce detail ||||||||||||||||
| portrait-face | limited | 100 | 166 | 7,499 | 3,357 | 34 | 459 | 16 | 11,717 / 9,795 | 203 | 12,248 | 2,046 | 664,269 | 18,390 | 23.6 MB / 7.4 MB | 910 | 17 / 150 |
| portrait-face | halftone | Error [too_many_primitives]: output would contain 1000005 primitives, limit is 1000000; increase pitch or reduce detail ||||||||||||||||
| concert-small-venue | bw | 170 | 290 | 214 | 509 | 1 | 12 | 1 | 1,036 / 861 | 33 | 1,451 | 64 | 17,089 | 223 | 656 KB / 238 KB | 357 | 17 / 17 |
| concert-small-venue | color | 170 | 62 | 3,822 | 1,812 | 301 | 287 | 12 | 6,395 / 6,006 | 175 | 6,966 | 1,288 | 424,222 | 28,858 | 16.9 MB / 5.9 MB | 538 | 17 / 133 |
| concert-small-venue | limited | 170 | 144 | 2,632 | 3,374 | 15 | 253 | 10 | 6,594 / 4,537 | 129 | 7,115 | 875 | 392,633 | 11,890 | 14.5 MB / 4.9 MB | 566 | 17 / 83 |
| concert-small-venue | halftone | 170 | 0 | 147 | 0 | 3 | 394 | 23 | 686 / 673 | 225 | 1,315 | 1,651 | 956,155 | 1 | 36.0 MB / 10.9 MB | 431 | 17 / 167 |
| concert-stage-light | bw | 193 | 306 | 230 | 614 | 1 | 28 | 3 | 1,193 / 1,153 | 33 | 1,634 | 108 | 44,171 | 618 | 1.6 MB / 531 KB | 334 | 17 / 17 |
| concert-stage-light | color | Error [too_many_primitives]: output would contain 1518220 primitives, limit is 1000000; increase pitch or reduce detail ||||||||||||||||
| concert-stage-light | limited | 196 | 173 | 9,873 | 1,559 | 14 | 313 | 11 | 12,124 / 12,045 | 135 | 12,677 | 1,086 | 459,239 | 6,764 | 16.3 MB / 5.1 MB | 809 | 17 / 100 |
| concert-stage-light | halftone | Error [too_many_primitives]: output would contain 1000005 primitives, limit is 1000000; increase pitch or reduce detail ||||||||||||||||
| texture-bark | bw | 273 | 379 | 410 | 978 | 4 | 91 | 5 | 1,893 / 1,857 | 51 | 2,433 | 344 | 139,629 | 904 | 5.1 MB / 1.7 MB | 732 | 17 / 17 |
| texture-bark | color | Error [too_many_primitives]: output would contain 3647967 primitives, limit is 1000000; increase pitch or reduce detail ||||||||||||||||
| texture-bark | limited | Error [too_many_primitives]: output would contain 2136198 primitives, limit is 1000000; increase pitch or reduce detail ||||||||||||||||
| texture-bark | halftone | Error [too_many_primitives]: output would contain 1000005 primitives, limit is 1000000; increase pitch or reduce detail ||||||||||||||||
| architecture-street | bw | 52 | 253 | 168 | 520 | 4 | 82 | 4 | 1,056 / 1,044 | 44 | 1,365 | 316 | 127,399 | 4,012 | 4.7 MB / 1.5 MB | 242 | 17 / 17 |
| architecture-street | color | 53 | 56 | 4,735 | 2,095 | 108 | 258 | 12 | 7,342 / 7,306 | 164 | 7,779 | 951 | 393,377 | 26,841 | 15.7 MB / 5.4 MB | 592 | 17 / 133 |
| architecture-street | limited | 51 | 141 | 3,393 | 1,160 | 13 | 225 | 9 | 5,036 / 4,976 | 125 | 5,430 | 762 | 338,883 | 10,897 | 12.0 MB / 3.8 MB | 567 | 17 / 83 |
| architecture-street | halftone | 52 | 0 | 156 | 0 | 4 | 408 | 21 | 708 / 690 | 238 | 1,229 | 1,683 | 977,400 | 1 | 36.8 MB / 11.3 MB | 438 | 17 / 183 |
| portrait-large | bw | 123 | 378 | 365 | 852 | 1 | 21 | 2 | 1,629 / 1,597 | 28 | 1,996 | 91 | 33,193 | 493 | 1.2 MB / 434 KB | 718 | 17 / 17 |
| portrait-large | color | 123 | 99 | 5,195 | 1,913 | 104 | 296 | 13 | 7,709 / 7,676 | 190 | 8,248 | 1,049 | 441,894 | 30,409 | 17.7 MB / 6.0 MB | 972 | 17 / 150 |
| portrait-large | limited | 123 | 206 | 3,166 | 1,574 | 14 | 269 | 10 | 5,385 / 5,351 | 133 | 5,865 | 921 | 396,035 | 11,754 | 14.5 MB / 4.7 MB | 866 | 17 / 100 |
| portrait-large | halftone | Error [too_many_primitives]: output would contain 1000005 primitives, limit is 1000000; increase pitch or reduce detail ||||||||||||||||
| concert-small-venue-1280 | bw | 19 | 29 | 25 | 49 | 0 | 2 | 1 | 108 / 109 | 30 | 363 | 10 | 3,734 | 52 | 123 KB / 48 KB | 44 | 17 / 17 |
| concert-small-venue-1280 | color | 20 | 10 | 455 | 260 | 10 | 56 | 3 | 812 / 810 | 44 | 1,083 | 192 | 87,738 | 5,994 | 3.1 MB / 1.2 MB | 110 | 17 / 17 |
| concert-small-venue-1280 | limited | 19 | 55 | 300 | 104 | 3 | 49 | 3 | 536 / 541 | 52 | 813 | 154 | 76,359 | 2,926 | 2.5 MB / 879 KB | 76 | 17 / 17 |
| concert-small-venue-1280 | halftone | 19 | 0 | 25 | 0 | 0 | 46 | 3 | 88 / 91 | 50 | 363 | 170 | 97,045 | 1 | 3.3 MB / 1.0 MB | 25 | 17 / 17 |

### firefox

| Image | Mode | Decode | Pre-process | Segment | Fit (compose) | Optimize+validate | SVG | Transfer+parse | WASM call cold / warm | Preview paint | Import→visible | PDF | Anchors | Paths | SVG / PDF size | WASM mem MiB | Max frame gap proc / preview |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| portrait-face | bw | 93 | 735 | 158 | 446 | 4 | 46 | 1 | 1,413 / 939 | 168 | 1,886 | 172 | 59,397 | 1,504 | 2.2 MB / 719 KB | 478 | 19 / 133 |
| portrait-face | limited | 96 | 328 | 7,758 | 3,023 | 32 | 540 | 21 | 11,915 / 10,170 | 1,351 | 13,594 | 1,751 | 664,269 | 18,390 | 23.6 MB / 7.4 MB | 910 | 19 / 850 |
| concert-small-venue | bw | 41 | 380 | 169 | 354 | 0 | 15 | 0 | 929 / 614 | 68 | 1,247 | 51 | 16,909 | 190 | 647 KB / 236 KB | 357 | 18 / 33 |
| concert-small-venue | limited | 37 | 266 | 2,765 | 2,646 | 26 | 341 | 15 | 6,278 / 4,771 | 307 | 6,847 | 1,123 | 438,775 | 13,516 | 16.2 MB / 5.5 MB | 575 | 19 / 90 |
| concert-small-venue-1280 | bw | 7 | 59 | 19 | 38 | 1 | 5 | 1 | 124 / 87 | 29 | 362 | 13 | 3,740 | 47 | 122 KB / 48 KB | 44 | 17 / 17 |
| concert-small-venue-1280 | limited | 6 | 89 | 343 | 224 | 6 | 64 | 2 | 767 / 625 | 61 | 1,039 | 191 | 82,337 | 3,356 | 2.6 MB / 942 KB | 76 | 19 / 28 |

### webkit

| Image | Mode | Decode | Pre-process | Segment | Fit (compose) | Optimize+validate | SVG | Transfer+parse | WASM call cold / warm | Preview paint | Import→visible | PDF | Anchors | Paths | SVG / PDF size | WASM mem MiB | Max frame gap proc / preview |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| portrait-face | bw | 145 | 387 | 122 | 364 | 2 | 35 | 4 | 927 / 778 | 48 | 1,335 | 143 | 59,437 | 1,499 | 2.2 MB / 719 KB | 478 | 19 / 21 |
| portrait-face | limited | 137 | 216 | 7,335 | 1,185 | 26 | 384 | 28 | 9,277 / 9,117 | 260 | 9,912 | 1,360 | 670,487 | 18,639 | 23.8 MB / 7.4 MB | 910 | 19 / 177 |
| concert-small-venue | bw | 75 | 163 | 124 | 251 | 1 | 11 | 3 | 560 / 524 | 28 | 894 | 49 | 17,092 | 227 | 656 KB / 238 KB | 357 | 18 / 17 |
| concert-small-venue | limited | 78 | 125 | 2,498 | 1,091 | 18 | 224 | 18 | 4,054 / 3,965 | 176 | 4,537 | 823 | 413,118 | 12,532 | 15.2 MB / 5.2 MB | 559 | 19 / 120 |
| concert-small-venue-1280 | bw | 11 | 38 | 15 | 33 | 0 | 3 | 4 | 94 / 79 | 19 | 336 | 15 | 3,703 | 53 | 122 KB / 48 KB | 44 | 19 / 15 |
| concert-small-venue-1280 | limited | 11 | 60 | 345 | 113 | 6 | 49 | 5 | 601 / 565 | 60 | 886 | 161 | 86,394 | 3,622 | 2.8 MB / 977 KB | 80 | 18 / 31 |
