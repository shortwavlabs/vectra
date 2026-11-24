### Sets: rejected,validation,negative

| Variant | Family | Fixtures passing | Rejected cases passing | Negative controls passing | Mean contour RMS (ideal) | Worst contour max (ideal) | Tangent breaks | Anchors (total) | Time (ms, total) |
|---|---|---|---|---|---|---|---|---|---|
| spline | baseline | 0/32 | 0/2 | 0/6 | 0.420 | 2.318 | 277 | 868 | 120.1 |
| D1-len2 | D1 | 0/32 | 0/2 | 0/6 | 0.466 | 2.965 | 179 | 1149 | 120.1 |
| D1-len8 | D1 | 1/32 | 0/2 | 1/6 | 0.361 | 2.486 | 323 | 717 | 121.7 |
| D1-splice20 | D1 | 0/32 | 0/2 | 0/6 | 0.411 | 1.256 | 553 | 1237 | 122.6 |
| D1-splice90 | D1 | 0/32 | 0/2 | 0/6 | 0.581 | 4.000 | 148 | 684 | 121.2 |
| D1-len2-splice20 | D1 | 0/32 | 0/2 | 0/6 | 0.433 | 1.401 | 369 | 1548 | 122.0 |
| D1-len8-splice90 | D1 | 0/32 | 0/2 | 0/6 | 0.579 | 3.998 | 187 | 545 | 121.1 |
| D1-corner30 | D1 | 0/32 | 0/2 | 0/6 | 0.423 | 2.916 | 261 | 835 | 121.1 |
| D1-corner90 | D1 | 0/32 | 0/2 | 0/6 | 0.457 | 3.001 | 288 | 971 | 120.6 |
| D1-polygon | D1 | 0/32 | 0/2 | 0/6 | 0.326 | 1.238 | 1003 | 1355 | 120.4 |
| D1g-lattice-G1 | D1 (Vectra G1 fit, no sub-pixel) | 4/32 | 0/2 | 4/6 | 0.243 | 0.814 | 4277 | 8659 | 136.1 |
| D2-linear | D2 | 13/32 | 1/2 | 6/6 | 0.075 | 0.569 | 79 | 1342 | 126.7 |
| D2-area | D2 | 18/32 | 1/2 | 6/6 | 0.066 | 0.569 | 107 | 929 | 123.6 |
| D3-lattice-arcs | D3 | 4/32 | 0/2 | 4/6 | 0.243 | 0.814 | 4277 | 8659 | 138.2 |
| D4-area-arcs | D4 | 19/32 | 1/2 | 6/6 | 0.050 | 0.569 | 107 | 899 | 128.3 |
| D2-area-sharpen | D2 + corner rebuild | 22/32 | 1/2 | 6/6 | 0.064 | 0.569 | 109 | 798 | 124.1 |
| D2-area-b1-sharpen | D2 + smoothing + corner rebuild | 21/32 | 1/2 | 6/6 | 0.068 | 0.464 | 9 | 702 | 123.6 |
| D2-area-b2-sharpen | D2 + smoothing + corner rebuild | 20/32 | 1/2 | 6/6 | 0.073 | 0.456 | 3 | 632 | 123.4 |
| D2-area-t1-sharpen | D2 + smoothing + corner rebuild | 22/32 | 1/2 | 6/6 | 0.065 | 0.440 | 44 | 758 | 125.9 |
| D2-area-t2-sharpen | D2 + smoothing + corner rebuild | 22/32 | 1/2 | 6/6 | 0.066 | 0.489 | 13 | 720 | 123.7 |
| D2-area-t4-sharpen | D2 + smoothing + corner rebuild | 22/32 | 1/2 | 6/6 | 0.062 | 0.489 | 7 | 699 | 125.1 |
| D2-linear-t2-sharpen | D2 + smoothing + corner rebuild | 18/32 | 1/2 | 6/6 | 0.070 | 0.489 | 8 | 896 | 123.3 |
| D4-area-t2-sharpen-arcs | D4 (D2 refined + recognition) | 24/32 | 1/2 | 6/6 | 0.046 | 0.489 | 13 | 611 | 122.1 |
| selected | selected: Options::production(60) | 24/32 | 1/2 | 6/6 | 0.046 | 0.489 | 13 | 611 | 125.0 |
| selected-no-arcs | selected without recognition | 22/32 | 1/2 | 6/6 | 0.066 | 0.489 | 13 | 720 | 123.0 |
| D2-area-tol0.1 | D2 sensitivity | 17/32 | 1/2 | 6/6 | 0.048 | 0.569 | 183 | 1458 | 127.5 |
| D2-area-tol0.3 | D2 sensitivity | 18/32 | 1/2 | 6/6 | 0.095 | 0.569 | 84 | 741 | 124.9 |
| D2-area-scale1.5 | D2 sensitivity | 18/32 | 1/2 | 6/6 | 0.069 | 0.569 | 93 | 945 | 124.6 |
| D2-area-scale3 | D2 sensitivity | 18/32 | 1/2 | 6/6 | 0.066 | 0.569 | 101 | 941 | 124.7 |

### P0 IoU metric (render 1×, coverage ≥ 0.5 mask), target ≥ 0.98

| Fixture | Variant | IoU |
|---|---|---|
| circle | spline | 0.9936 |
| circle | D1-len2 | 0.9932 |
| circle | D1-len8 | 0.9956 |
| circle | D1-splice20 | 0.9941 |
| circle | D1-splice90 | 0.9873 |
| circle | D1-len2-splice20 | 0.9932 |
| circle | D1-len8-splice90 | 0.9840 |
| circle | D1-corner30 | 0.9936 |
| circle | D1-corner90 | 0.9936 |
| circle | D1-polygon | 0.9952 |
| circle | D1g-lattice-G1 | 0.9984 |
| circle | D2-linear | 0.9976 |
| circle | D2-area | 0.9976 |
| circle | D3-lattice-arcs | 0.9984 |
| circle | D4-area-arcs | 0.9990 |
| circle | D2-area-sharpen | 0.9976 |
| circle | D2-area-b1-sharpen | 0.9976 |
| circle | D2-area-b2-sharpen | 0.9968 |
| circle | D2-area-t1-sharpen | 0.9978 |
| circle | D2-area-t2-sharpen | 0.9974 |
| circle | D2-area-t4-sharpen | 0.9968 |
| circle | D2-linear-t2-sharpen | 0.9974 |
| circle | D4-area-t2-sharpen-arcs | 0.9990 |
| circle | selected | 0.9990 |
| circle | selected-no-arcs | 0.9974 |
| circle | D2-area-tol0.1 | 0.9986 |
| circle | D2-area-tol0.3 | 0.9968 |
| circle | D2-area-scale1.5 | 0.9975 |
| circle | D2-area-scale3 | 0.9973 |
| sharp_corners | spline | 0.9771 |
| sharp_corners | D1-len2 | 0.9775 |
| sharp_corners | D1-len8 | 0.9772 |
| sharp_corners | D1-splice20 | 0.9771 |
| sharp_corners | D1-splice90 | 0.9776 |
| sharp_corners | D1-len2-splice20 | 0.9775 |
| sharp_corners | D1-len8-splice90 | 0.9775 |
| sharp_corners | D1-corner30 | 0.9777 |
| sharp_corners | D1-corner90 | 0.9621 |
| sharp_corners | D1-polygon | 0.9781 |
| sharp_corners | D1g-lattice-G1 | 0.9945 |
| sharp_corners | D2-linear | 0.9951 |
| sharp_corners | D2-area | 0.9942 |
| sharp_corners | D3-lattice-arcs | 0.9945 |
| sharp_corners | D4-area-arcs | 0.9942 |
| sharp_corners | D2-area-sharpen | 0.9945 |
| sharp_corners | D2-area-b1-sharpen | 0.9965 |
| sharp_corners | D2-area-b2-sharpen | 0.9969 |
| sharp_corners | D2-area-t1-sharpen | 0.9962 |
| sharp_corners | D2-area-t2-sharpen | 0.9958 |
| sharp_corners | D2-area-t4-sharpen | 0.9957 |
| sharp_corners | D2-linear-t2-sharpen | 0.9942 |
| sharp_corners | D4-area-t2-sharpen-arcs | 0.9958 |
| sharp_corners | selected | 0.9958 |
| sharp_corners | selected-no-arcs | 0.9958 |
| sharp_corners | D2-area-tol0.1 | 0.9954 |
| sharp_corners | D2-area-tol0.3 | 0.9927 |
| sharp_corners | D2-area-scale1.5 | 0.9940 |
| sharp_corners | D2-area-scale3 | 0.9929 |
| nested_rings | spline | 0.9752 |
| nested_rings | D1-len2 | 0.9672 |
| nested_rings | D1-len8 | 0.9852 |
| nested_rings | D1-splice20 | 0.9689 |
| nested_rings | D1-splice90 | 0.9523 |
| nested_rings | D1-len2-splice20 | 0.9654 |
| nested_rings | D1-len8-splice90 | 0.9655 |
| nested_rings | D1-corner30 | 0.9752 |
| nested_rings | D1-corner90 | 0.9752 |
| nested_rings | D1-polygon | 0.9808 |
| nested_rings | D1g-lattice-G1 | 0.9930 |
| nested_rings | D2-linear | 0.9938 |
| nested_rings | D2-area | 0.9902 |
| nested_rings | D3-lattice-arcs | 0.9930 |
| nested_rings | D4-area-arcs | 0.9962 |
| nested_rings | D2-area-sharpen | 0.9902 |
| nested_rings | D2-area-b1-sharpen | 0.9919 |
| nested_rings | D2-area-b2-sharpen | 0.9921 |
| nested_rings | D2-area-t1-sharpen | 0.9905 |
| nested_rings | D2-area-t2-sharpen | 0.9916 |
| nested_rings | D2-area-t4-sharpen | 0.9923 |
| nested_rings | D2-linear-t2-sharpen | 0.9918 |
| nested_rings | D4-area-t2-sharpen-arcs | 0.9960 |
| nested_rings | selected | 0.9960 |
| nested_rings | selected-no-arcs | 0.9916 |
| nested_rings | D2-area-tol0.1 | 0.9939 |
| nested_rings | D2-area-tol0.3 | 0.9880 |
| nested_rings | D2-area-scale1.5 | 0.9916 |
| nested_rings | D2-area-scale3 | 0.9924 |
