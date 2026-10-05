#!/bin/sh
# Sequential driver: ONE node process at a time, each under ~4 minutes.
cd /c/source/neural-net-builder
P=experiments/plasticity
node $P/longrun.mjs full-on-words 1,2      > $P/out-long-1.txt 2>&1
node $P/longrun.mjs full-never 2,3         > $P/out-long-2.txt 2>&1
node $P/longrun.mjs full-on-words 3        > $P/out-long-3.txt 2>&1
node $P/sweep.mjs a2                       > $P/out-sweep-a2.txt 2>&1
node $P/longrun.mjs asLoaded-on-words 1,2  > $P/out-long-4.txt 2>&1
node $P/longrun.mjs asLoaded-on-words 3    > $P/out-long-5.txt 2>&1
node $P/longrun.mjs full-off-words 1,2,3   > $P/out-long-6.txt 2>&1
node $P/sweep.mjs d                        > $P/out-sweep-d.txt 2>&1
node $P/sweep.mjs e                        > $P/out-sweep-e.txt 2>&1
node $P/sweep.mjs b                        > $P/out-sweep-b.txt 2>&1
node $P/sweep.mjs c                        > $P/out-sweep-c.txt 2>&1
node $P/longrun.mjs full-on-random 1,2,3   > $P/out-long-7.txt 2>&1
echo ALLDONE > $P/out-done.txt
node $P/diag.mjs 30000 1,2,3 > $P/out-diag.txt 2>&1
echo DIAGDONE > $P/out-done2.txt
node $P/proto.mjs 1,2,3 proto-lr0.01-th0.3,proto-lr0.003-th0.3 > $P/out-proto.txt 2>&1
node $P/summarize.mjs > $P/summary.txt 2>&1
echo PROTODONE > $P/out-done3.txt
