#!/bin/sh

alias ls="ls --color=auto"

alias grep="grep --color=auto"

alias diff="diff --color"

alias pspa="ps -eo pid,args"

alias pspac='ps -eo pid,args>"$HOME"/.pspidargs.sh ; glow "$HOME"/.pspidargs.sh'
