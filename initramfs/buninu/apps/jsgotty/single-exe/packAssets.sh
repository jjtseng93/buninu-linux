#!/bin/sh

sd=$(dirname "$0")

cd "$sd"/..

tar -cvf single-exe/assets.tar static README.md README.en.md
