/* Windows x64 ABI, no CRT. All addresses are RIP-relative.
 * Assembled as an ELF object only to extract code/relocations for the JS builder.
 */
.intel_syntax noprefix
.text
.global entry
entry:
    sub rsp, 88                 /* shadow space, six stack args, 16-byte alignment */
    cld
    xor ecx, ecx
    lea rdx, [rip + self]
    mov r8d, 32768
    call [rip + imp_GetModuleFileNameW]
    test eax, eax
    jz win_error
    cmp eax, 32768
    jae too_long
    cmp eax, 4
    jb invalid
    mov r12d, eax
    lea rsi, [rip + self]
    lea r13, [rsi + rax*2]
find_directory:
    cmp r13, rsi
    je invalid
    sub r13, 2
    cmp word ptr [r13], 92
    jne find_directory
    add r13, 2

    /* Resolve Bun only beside the loader; no shell or PATH recursion. */
    lea rdi, [rip + bun]
    lea r15, [rip + bun + 65534]
    call copy_directory
    lea rsi, [rip + bun_name]
    call copy_z
    mov word ptr [rdi], 0

    cmp byte ptr [rip + direct_bun], 0
    jne script_ready

    /* Preserve the invoked command for multicall on Windows (no /proc). */
    lea rcx, [rip + caller_env]
    lea rdx, [rip + self]
    call [rip + imp_SetEnvironmentVariableW]
    test eax, eax
    jz win_error

    /* jmi.exe -> jmi.sh. Windows supplies the executable's absolute path. */
    lea rdi, [rip + self]
    lea rdi, [rdi + r12*2 - 8]
    mov dword ptr [rdi], 0x0073002e
    mov dword ptr [rdi + 4], 0x00000068

    lea rcx, [rip + self]
    call [rip + imp_GetFileAttributesW]
    cmp eax, -1
    jne script_ready
    mov rdi, r13
    lea r15, [rip + self + 65534]
    lea rsi, [rip + multicall]
    call copy_z
    mov word ptr [rdi], 0
    lea rcx, [rip + self]
    call [rip + imp_GetFileAttributesW]
    cmp eax, -1
    jne script_ready
    mov r12d, 127
    jmp error
script_ready:
    call [rip + imp_GetCommandLineW]
    mov r14, rax
    xor ecx, ecx
skip_argv0:
    movzx eax, word ptr [r14]
    test eax, eax
    jz tail_ready
    cmp eax, 34
    jne not_quote
    xor ecx, 1
    jmp next_argv0
not_quote:
    test ecx, ecx
    jnz next_argv0
    cmp eax, 32
    je tail_ready
    cmp eax, 9
    je tail_ready
next_argv0:
    add r14, 2
    jmp skip_argv0
tail_ready:
    lea rdi, [rip + command]
    lea r15, [rip + command + 65534]
    lea rsi, [rip + quote]
    call copy_z
    lea rsi, [rip + bun]
    call copy_z
    cmp byte ptr [rip + direct_bun], 0
    jne close_bun_quote
    lea rsi, [rip + separator]
    call copy_z
    call copy_directory
    lea rsi, [rip + interpreter]
    call copy_z
    lea rsi, [rip + separator]
    call copy_z
    lea rsi, [rip + self]
    call copy_z
close_bun_quote:
    lea rsi, [rip + quote]
    call copy_z
    mov rsi, r14                /* original tail, no argv reserialization */
    call copy_z
    mov word ptr [rdi], 0

    lea rcx, [rip + ctrl_handler]
    mov edx, 1
    call [rip + imp_SetConsoleCtrlHandler]
    mov dword ptr [rip + startup], 104
    mov dword ptr [rip + startup + 60], 256
    /* Standard handles need not already be inheritable (e.g. Bun's console
     * handles). Duplicate them without changing the caller's handle flags. */
    lea rbx, [rip + startup + 80]
    mov r12d, -10
copy_std_handle:
    mov ecx, r12d
    call [rip + imp_GetStdHandle]
    mov [rbx], rax
    test rax, rax
    jz next_std_handle
    cmp rax, -1
    je next_std_handle
    mov rcx, -1                /* GetCurrentProcess pseudo handle */
    mov rdx, rax
    mov r8, -1
    mov r9, rbx
    mov qword ptr [rsp + 32], 0
    mov qword ptr [rsp + 40], 1 /* inheritable */
    mov qword ptr [rsp + 48], 2 /* DUPLICATE_SAME_ACCESS */
    call [rip + imp_DuplicateHandle]
    test eax, eax
    jz win_error
next_std_handle:
    add rbx, 8
    dec r12d
    cmp r12d, -13
    jne copy_std_handle

    lea rcx, [rip + bun]
    lea rdx, [rip + command]
    xor r8d, r8d
    xor r9d, r9d
    mov qword ptr [rsp + 32], 1
    mov qword ptr [rsp + 40], 0
    mov qword ptr [rsp + 48], 0
    mov qword ptr [rsp + 56], 0
    lea rax, [rip + startup]
    mov [rsp + 64], rax
    lea rax, [rip + process_info]
    mov [rsp + 72], rax
    call [rip + imp_CreateProcessW]
    test eax, eax
    jz win_error
    /* Child owns its inherited copies; close ours before waiting, so pipes
     * can reach EOF as soon as the child closes them. */
    lea rbx, [rip + startup + 80]
    mov r12d, 3
close_std_handle:
    mov rcx, [rbx]
    test rcx, rcx
    jz next_close_std
    cmp rcx, -1
    je next_close_std
    call [rip + imp_CloseHandle]
next_close_std:
    add rbx, 8
    dec r12d
    jnz close_std_handle
    mov rcx, [rip + process_info + 8]
    call [rip + imp_CloseHandle]
    mov rcx, [rip + process_info]
    mov edx, -1
    call [rip + imp_WaitForSingleObject]
    cmp eax, -1
    je win_error
    mov rcx, [rip + process_info]
    lea rdx, [rip + exit_code]
    call [rip + imp_GetExitCodeProcess]
    test eax, eax
    jz win_error
    mov rcx, [rip + process_info]
    call [rip + imp_CloseHandle]
    mov ecx, [rip + exit_code]
    call [rip + imp_ExitProcess]

/* Leaf helpers; destination rdi, exclusive limit r15, source rsi. */
copy_directory:
    lea rsi, [rip + self]
copy_directory_loop:
    cmp rsi, r13
    je copy_done
    cmp rdi, r15
    jae helper_too_long
    mov ax, [rsi]
    mov [rdi], ax
    add rsi, 2
    add rdi, 2
    jmp copy_directory_loop
copy_z:
    mov ax, [rsi]
    test ax, ax
    jz copy_done
    cmp rdi, r15
    jae helper_too_long
    mov [rdi], ax
    add rsi, 2
    add rdi, 2
    jmp copy_z
copy_done:
    ret
helper_too_long:
    add rsp, 8                 /* discard helper return address */
too_long:
    mov r12d, 206
    jmp error
invalid:
    mov r12d, 87
    jmp error
win_error:
    call [rip + imp_GetLastError]
    mov r12d, eax
error:
    mov ecx, -12
    call [rip + imp_GetStdHandle]
    mov rcx, rax
    lea rdx, [rip + error_message]
    mov r8d, 86
    lea r9, [rip + exit_code]
    mov qword ptr [rsp + 32], 0
    call [rip + imp_WriteFile]
    mov ecx, r12d
    call [rip + imp_ExitProcess]

ctrl_handler:
    xor eax, eax
    cmp ecx, 1                 /* let the child handle CTRL_C / CTRL_BREAK */
    seta al
    xor eax, 1
    ret
