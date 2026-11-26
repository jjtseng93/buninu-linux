/* Windows ARM64 ABI. x18 is reserved. No CRT; no absolute addresses. */
.text
.global entry
.macro address reg, symbol
    adrp \reg, \symbol
    add \reg, \reg, :lo12:\symbol
.endm
.macro api symbol
    adrp x16, imp_\symbol
    ldr x16, [x16, :lo12:imp_\symbol]
    blr x16
.endm
entry:
    sub sp, sp, #32
    mov x0, #0
    address x1, self
    mov w2, #32768
    api GetModuleFileNameW
    cbz w0, win_error
    cmp w0, #8, lsl #12
    b.hs too_long
    cmp w0, #4
    b.lo invalid
    mov w22, w0
    address x20, self
    add x23, x20, x0, lsl #1
find_directory:
    cmp x23, x20
    b.eq invalid
    sub x23, x23, #2
    ldrh w9, [x23]
    cmp w9, #92
    b.ne find_directory
    add x23, x23, #2

    address x19, bun
    address x21, bun_limit
    bl copy_directory
    address x20, bun_name
    bl copy_z
    strh wzr, [x19]

    address x9, direct_bun
    ldrb w9, [x9]
    cbnz w9, script_ready

    address x0, caller_env
    address x1, self
    api SetEnvironmentVariableW
    cbz w0, win_error

    address x19, self
    add x19, x19, x22, lsl #1
    sub x19, x19, #8
    mov w9, #46
    movk w9, #115, lsl #16
    str w9, [x19]
    mov w9, #104
    str w9, [x19, #4]

    address x0, self
    api GetFileAttributesW
    cmn w0, #1
    b.ne script_ready
    mov x19, x23
    address x21, self
    mov x9, #65534
    add x21, x21, x9
    address x20, multicall
    bl copy_z
    strh wzr, [x19]
    address x0, self
    api GetFileAttributesW
    cmn w0, #1
    b.ne script_ready
    mov w22, #127
    b error
script_ready:
    api GetCommandLineW
    mov x24, x0
    mov w10, #0
skip_argv0:
    ldrh w9, [x24]
    cbz w9, tail_ready
    cmp w9, #34
    b.ne not_quote
    eor w10, w10, #1
    b next_argv0
not_quote:
    cbnz w10, next_argv0
    cmp w9, #32
    b.eq tail_ready
    cmp w9, #9
    b.eq tail_ready
next_argv0:
    add x24, x24, #2
    b skip_argv0
tail_ready:
    address x19, command
    address x21, command_limit
    address x20, quote
    bl copy_z
    address x20, bun
    bl copy_z
    address x9, direct_bun
    ldrb w9, [x9]
    cbnz w9, close_bun_quote
    address x20, separator
    bl copy_z
    bl copy_directory
    address x20, interpreter
    bl copy_z
    address x20, separator
    bl copy_z
    address x20, self
    bl copy_z
close_bun_quote:
    address x20, quote
    bl copy_z
    mov x20, x24
    bl copy_z
    strh wzr, [x19]

    adr x0, ctrl_handler
    mov w1, #1
    api SetConsoleCtrlHandler
    address x25, startup
    mov w9, #104
    str w9, [x25]
    mov w9, #256
    str w9, [x25, #60]
    /* Duplicate valid standard handles as inheritable; preserve absent ones. */
    add x27, x25, #80
    mov w28, #-10
copy_std_handle:
    mov w0, w28
    api GetStdHandle
    str x0, [x27]
    cbz x0, next_std_handle
    cmn x0, #1
    b.eq next_std_handle
    mov x1, x0
    mov x0, #-1
    mov x2, #-1
    mov x3, x27
    mov w4, #0
    mov w5, #1
    mov w6, #2
    api DuplicateHandle
    cbz w0, win_error
next_std_handle:
    add x27, x27, #8
    sub w28, w28, #1
    cmn w28, #13
    b.ne copy_std_handle

    address x0, bun
    address x1, command
    mov x2, #0
    mov x3, #0
    mov w4, #1
    mov w5, #0
    mov x6, #0
    mov x7, #0
    str x25, [sp]
    address x26, process_info
    str x26, [sp, #8]
    api CreateProcessW
    cbz w0, win_error
    /* Drop the parent's duplicate handles before waiting for the child. */
    add x27, x25, #80
    mov w28, #3
close_std_handle:
    ldr x0, [x27]
    cbz x0, next_close_std
    cmn x0, #1
    b.eq next_close_std
    api CloseHandle
next_close_std:
    add x27, x27, #8
    subs w28, w28, #1
    b.ne close_std_handle
    ldr x0, [x26, #8]
    api CloseHandle
    ldr x0, [x26]
    mov w1, #-1
    api WaitForSingleObject
    cmn w0, #1
    b.eq win_error
    ldr x0, [x26]
    address x1, exit_code
    api GetExitCodeProcess
    cbz w0, win_error
    ldr x0, [x26]
    api CloseHandle
    address x9, exit_code
    ldr w0, [x9]
    api ExitProcess

copy_directory:
    address x20, self
copy_directory_loop:
    cmp x20, x23
    b.eq copy_done
    cmp x19, x21
    b.hs too_long
    ldrh w9, [x20], #2
    strh w9, [x19], #2
    b copy_directory_loop
copy_z:
    ldrh w9, [x20]
    cbz w9, copy_done
    cmp x19, x21
    b.hs too_long
    strh w9, [x19], #2
    add x20, x20, #2
    b copy_z
copy_done:
    ret
too_long:
    mov w22, #206
    b error
invalid:
    mov w22, #87
    b error
win_error:
    api GetLastError
    mov w22, w0
error:
    mov w0, #-12
    api GetStdHandle
    address x1, error_message
    mov w2, #86
    address x3, exit_code
    mov x4, #0
    api WriteFile
    mov w0, w22
    api ExitProcess
ctrl_handler:
    cmp w0, #1
    cset w0, ls
    ret
