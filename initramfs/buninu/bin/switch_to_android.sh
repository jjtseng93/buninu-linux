#!/bin/sh

sd=$(dirname "$0")

annl=androidNativeLibs

ln -sfT $annl/libbun.so "$sd"/bun

ln -sfT $annl/libsh-loader.so "$sd"/shloader
