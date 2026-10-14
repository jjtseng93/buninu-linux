#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { cli } from "./lib/common.js";
import {
  buildRoot, canonicalizers, command,
  configure, makeIn, deps, ready,
  source, stage, tools,
} from "./lib/build.js";

async function main(args) {
  const { triple } = stage(
    9, "mpc", args
  );
  const src = await source(
    "mpc@0.8.1", "mpc-0.8.1"
  );
  const build = buildRoot + "/mpc";
  canonicalizers(src);
  await configure(src, build, [
    "--build=" + triple,
    "--host=" + triple,
    "--prefix=" + deps,
    "--disable-shared",
    "--enable-static",
    "--disable-dependency-tracking",
    "--with-gmp=" + deps,
    "--with-mpfr=" + deps,
  ]);
  await makeIn(build);
  await makeIn(build, ["install"]);
  await verifyMath(build);
  ready(9, "GMP, MPFR and MPC math");
}

async function verifyMath(build) {
  writeFileSync(build + "/verify-math.c", `#include <gmp.h>
#include <mpfr.h>
#include <mpc.h>
int main(void){
mpz_t z;mpfr_t f;mpc_t c;
mpz_init(z);mpz_ui_pow_ui(z,2,100);
if(mpz_sizeinbase(z,2)!=101)return 1;
mpz_sub_ui(z,z,1);if(mpz_popcount(z)!=100)return 2;
mpfr_init2(f,128);mpfr_set_ui(f,144,GMP_RNDN);mpfr_sqrt(f,f,GMP_RNDN);
if(mpfr_cmp_ui(f,12))return 3;
mpc_init2(c,128);mpc_set_ui_ui(c,3,4,MPC_RNDNN);mpc_mul(c,c,c,MPC_RNDNN);
if(mpfr_cmp_si(mpc_realref(c),-7)||mpfr_cmp_ui(mpc_imagref(c),24))return 4;
mpc_clear(c);mpfr_clear(f);mpz_clear(z);return 0;}
`);
  await command([tools + "/cc", "-I" + deps + "/include", "verify-math.c",
    deps + "/lib/libmpc.a", deps + "/lib/libmpfr.a", deps + "/lib/libgmp.a", "-o", "verify-math"], build);
  await command([build + "/verify-math"], build);
}

if (import.meta.main) await cli(main);
