# P1-A benchmark runs

Machine state for each run. Load averages are also inside each JSON file. Apple M5 Max, macOS, Node 24.22.1.

## no-ngspice (primary)

```text
start 23:43:10 load averages: 12.11 23.61 23.68 ngspice=0 busy>50%=14
bench exit 0 23:44:49 load averages: 10.11 19.81 22.20 busy=5
open-profile 23:44:56 load averages: 10.08 19.49 22.06 busy=5
dispatch 23:45:07 load averages: 9.30 19.01 21.86 busy=4
copyout 23:45:20 load averages: 8.71 18.41 21.59 busy=4 ngspice=0
```

`busy` is the number of processes above 50 % CPU (another project's jobs; no `ngspice`).

## loaded-ngspice (comparison)

```text
Loaded runs (ngspice active); load averages are also recorded inside each JSON file.
gdoc-bench.json        23:14-23:16  load 25.8 -> 12.0, ngspice 16 -> 6
open-profile-*.json    23:26        load 4.9-5.0 (ngspice count not recorded)
copyout-*.json         23:28        load 20.7 -> 26.2, ngspice 28
dispatch-profile-*.json 23:42       load 12.4-13.6, ngspice 3
```
