# Keybindings

- bunmicro has a plethora of hotkeys that make it easy and powerful to use.

- Custom keybindings are not implemented in bunmicro for now
- For a list of actions like CursorUp
- Press Ctrl+E to show command prompt
- `> help actions` 
- It is recommended to use jsplugins to register a command for such purposes
- Examples under runtime/jsplugins
- If you really wish to rebind keys, edit src/index.js and look for things like alt-d


- For a more user-friendly list with
explanations of what the default hotkeys are and what they do
- Press Ctrl+E to show command prompt
- `> help defaultkeys` 
- a json formatted list of default keys is included at the end of this document


You can use Ctrl + arrows to move word by word (Alt + arrows for Mac). Alt + left and right
move the cursor to the start and end of the line (Ctrl + left/right for Mac), and Ctrl + up and down move the
cursor to the start and end of the buffer.

You can hold shift with all of these movement actions to select while moving.


## Note for macOS
- By default, macOS terminals do not forward alt events and
instead insert unicode characters. To fix this, do the following:

* iTerm2: select `Esc+` for `Left Option Key` in `Preferences->Profiles->Keys`.
* Terminal.app: Enable `Use Option key as Meta key` in `Preferences->Profiles->Keyboard`.

### iTerm2

In iTerm2, you can do this in  `Preferences->Profiles->Keys` then click the
`+`, input your keybinding, and for the `Action` select `Send Escape Sequence`.
For the above example your would type `ctrlback` into the box (the `\x1b`) is
automatically sent by iTerm2.


## Actions binding (not implemented)

The `StartOfTextToggle` and `SelectToStartOfTextToggle` actions toggle between
jumping to the start of the text (first) and start of the line.

The `CutLine` action cuts the current line and adds it to the previously cut
lines in the clipboard since the last paste (rather than just replaces the
clipboard contents with this line). So you can cut multiple, not necessarily
consecutive lines to the clipboard just by pressing `Ctrl-k` multiple times,
without selecting them. If you want the more traditional behavior i.e. just
rewrite the clipboard every time, you can use `CopyLine,DeleteLine` action
instead of `CutLine`.

You can also bind some mouse actions (these must be bound to mouse buttons)

```
MousePress
MouseDrag
MouseRelease
MouseMultiCursor
```

Here is the list of all possible keys you can bind:

```
Up
Down
Right
Left
UpLeft
UpRight
DownLeft
DownRight
Center
PageUp
PageDown
Home
End
Insert
Delete
Help
Exit
Clear
Cancel
Print
Pause
Backtab
F1
F2
F3
F4
F5
F6
F7
F8
F9
F10
F11
F12
F13
F14
F15
F16
F17
F18
F19
F20
F21
F22
F23
F24
F25
F26
F27
F28
F29
F30
F31
F32
F33
F34
F35
F36
F37
F38
F39
F40
F41
F42
F43
F44
F45
F46
F47
F48
F49
F50
F51
F52
F53
F54
F55
F56
F57
F58
F59
F60
F61
F62
F63
F64
CtrlSpace
Ctrl-a
Ctrl-b
Ctrl-c
Ctrl-d
Ctrl-e
Ctrl-f
Ctrl-g
Ctrl-h
Ctrl-i
Ctrl-j
Ctrl-k
Ctrl-l
Ctrl-m
Ctrl-n
Ctrl-o
Ctrl-p
Ctrl-q
Ctrl-r
Ctrl-s
Ctrl-t
Ctrl-u
Ctrl-v
Ctrl-w
Ctrl-x
Ctrl-y
Ctrl-z
CtrlLeftSq
CtrlBackslash
CtrlRightSq
CtrlCarat
CtrlUnderscore
Backspace
OldBackspace
Tab
Esc
Escape
Enter
```

You can also bind some mouse buttons (they may be bound to normal actions or
mouse actions)

```
MouseLeft
MouseLeftDrag
MouseLeftRelease
MouseMiddle
MouseMiddleDrag
MouseMiddleRelease
MouseRight
MouseRightDrag
MouseRightRelease
MouseWheelUp
MouseWheelDown
MouseWheelLeft
MouseWheelRight
```



# Default keybinding configuration.

A select few keybindings are different on MacOS compared to other
operating systems. This is because different OSes have different
conventions for text editing defaults.

```json
{
    "Up":             "CursorUp",
    "Down":           "CursorDown",
    "Right":          "CursorRight",
    "Left":           "CursorLeft",
    "ShiftUp":        "SelectUp",
    "ShiftDown":      "SelectDown",
    "ShiftLeft":      "SelectLeft",
    "ShiftRight":     "SelectRight",
    "AltLeft":        "WordLeft", (Mac)
    "AltRight":       "WordRight", (Mac)
    "AltUp":          "MoveLinesUp",
    "AltDown":        "MoveLinesDown",
    "CtrlShiftRight": "SelectWordRight",
    "CtrlShiftLeft":  "SelectWordLeft",
    "AltLeft":        "StartOfTextToggle",
    "AltRight":       "EndOfLine",
    "AltShiftRight":  "SelectWordRight", (Mac)
    "AltShiftLeft":   "SelectWordLeft", (Mac)
    "CtrlLeft":       "StartOfText", (Mac)
    "CtrlRight":      "EndOfLine", (Mac)
    "AltShiftLeft":   "SelectToStartOfTextToggle",
    "CtrlShiftLeft":  "SelectToStartOfTextToggle", (Mac)
    "ShiftHome":      "SelectToStartOfTextToggle",
    "AltShiftRight":  "SelectToEndOfLine",
    "CtrlShiftRight": "SelectToEndOfLine", (Mac)
    "ShiftEnd":       "SelectToEndOfLine",
    "CtrlUp":         "CursorStart",
    "CtrlDown":       "CursorEnd",
    "CtrlShiftUp":    "SelectToStart",
    "CtrlShiftDown":  "SelectToEnd",
    "Alt-{":          "ParagraphPrevious",
    "Alt-}":          "ParagraphNext",
    "Enter":          "InsertNewline",
    "Ctrl-h":         "Backspace",
    "Backspace":      "Backspace",
    "Alt-CtrlH":      "DeleteWordLeft",
    "Alt-Backspace":  "DeleteWordLeft",
    "Tab":            "Autocomplete|IndentSelection|InsertTab",
    "Backtab":        "OutdentSelection|OutdentLine",
    "Ctrl-o":         "OpenFile",
    "Ctrl-s":         "Save",
    "Ctrl-f":         "Find",
    "Alt-F":          "FindLiteral",
    "Ctrl-n":         "FindNext",
    "Ctrl-p":         "FindPrevious",
    "Alt-[":          "DiffPrevious|CursorStart",
    "Alt-]":          "DiffNext|CursorEnd",
    "Ctrl-z":         "Undo",
    "Ctrl-y":         "Redo",
    "Ctrl-c":         "Copy|CopyLine",
    "Ctrl-x":         "Cut|CutLine",
    "Ctrl-k":         "CutLine",
    "Ctrl-d":         "Duplicate|DuplicateLine",
    "Ctrl-v":         "Paste",
    "Ctrl-a":         "SelectAll",
    "Ctrl-t":         "AddTab",
    "Alt-,":          "PreviousTab|LastTab",
    "Alt-.":          "NextTab|FirstTab",
    "Home":           "StartOfText",
    "End":            "EndOfLine",
    "CtrlHome":       "CursorStart",
    "CtrlEnd":        "CursorEnd",
    "PageUp":         "CursorPageUp",
    "PageDown":       "CursorPageDown",
    "CtrlPageUp":     "PreviousTab|LastTab",
    "CtrlPageDown":   "NextTab|FirstTab",
    "ShiftPageUp":    "SelectPageUp",
    "ShiftPageDown":  "SelectPageDown",
    "Ctrl-g":         "ToggleHelp",
    "Alt-g":          "ToggleKeyMenu",
    "Ctrl-r":         "ToggleRuler",
    "Ctrl-l":         "command-edit:goto ",
    "Delete":         "Delete",
    "Ctrl-b":         "ShellMode",
    "Ctrl-q":         "Quit",
    "Ctrl-e":         "CommandMode",
    "Ctrl-w":         "NextSplit|FirstSplit",
    
    
    // macro insert
    // not implemented yet
    "Ctrl-u":         "ToggleMacro",
    "Ctrl-j":         "PlayMacro",
    "Insert":         "ToggleOverwriteMode",
    

    // Emacs-style keybindings
    // not implemented yet
    "Alt-f": "WordRight",
    "Alt-b": "WordLeft",
    "Alt-a": "StartOfLine",
    "Alt-e": "EndOfLine",

    // Integration with file managers
    // not implemented yet
    "F2":  "Save",
    "F3":  "Find",
    "F4":  "Quit",
    "F7":  "Find",
    "F10": "Quit",
    "Esc": "Escape",

    // Mouse bindings
    "MouseWheelUp":     "ScrollUp",
    "MouseWheelDown":   "ScrollDown",
    "MouseLeft":        "MousePress",
    "MouseLeftDrag":    "MouseDrag",
    "MouseLeftRelease": "MouseRelease",
    "MouseMiddle":      "PastePrimary",
    "Ctrl-MouseLeft":   "MouseMultiCursor",

    // Multi-cursor bindings
    // not implemented yet
    "Alt-n":        "SpawnMultiCursor",
    "AltShiftUp":   "SpawnMultiCursorUp",
    "AltShiftDown": "SpawnMultiCursorDown",
    "Alt-m":        "SpawnMultiCursorSelect",
    "Alt-p":        "RemoveMultiCursor",
    "Alt-c":        "RemoveAllMultiCursors",
    "Alt-x":        "SkipMultiCursor",
}
```


## Final notes

- Note: On some old terminal emulators and on Windows machines, `Ctrl-h` should be used for backspace.

- Please note that terminal emulators are strange applications and micro only receives key events that the terminal decides to send. 
- Some terminal emulators may not send certain events even if this document says micro can receive the event. 
- To see exactly what micro receives from the terminal when you press a key,
- Press Ctrl+E to show command prompt
- then run the `> raw` command.
