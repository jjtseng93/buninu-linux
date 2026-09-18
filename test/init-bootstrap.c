typedef unsigned long usize;

static long syscall6(long number, long a1, long a2, long a3,
                     long a4, long a5, long a6) {
    register long r10 __asm__("r10") = a4;
    register long r8 __asm__("r8") = a5;
    register long r9 __asm__("r9") = a6;
    long result;
    __asm__ volatile("syscall"
                     : "=a"(result)
                     : "a"(number), "D"(a1), "S"(a2), "d"(a3),
                       "r"(r10), "r"(r8), "r"(r9)
                     : "rcx", "r11", "memory");
    return result;
}

static long mount_fs(const char *source, const char *target, const char *type) {
    return syscall6(165, (long)source, (long)target, (long)type, 0, 0, 0);
}

__attribute__((noreturn)) void _start(void) {
    static char bun[] = "/bin/bun";
    static char script[] = "/init.js";
    static char path[] = "PATH=/bin";
    static char home[] = "HOME=/";
    static char term[] = "TERM=linux";
    char *argv[] = {bun, script, 0};
    char *envp[] = {path, home, term, 0};

    mount_fs("devtmpfs", "/dev", "devtmpfs");
    mount_fs("proc", "/proc", "proc");
    mount_fs("sysfs", "/sys", "sysfs");
    mount_fs("tmpfs", "/tmp", "tmpfs");

    long console = syscall6(2, (long)"/dev/ttyS0", 2, 0, 0, 0, 0);
    if (console < 0)
        console = syscall6(2, (long)"/dev/console", 2, 0, 0, 0, 0);
    if (console >= 0) {
        syscall6(33, console, 0, 0, 0, 0, 0);
        syscall6(33, console, 1, 0, 0, 0, 0);
        syscall6(33, console, 2, 0, 0, 0, 0);
        if (console > 2)
            syscall6(3, console, 0, 0, 0, 0, 0);
    }

    static const char starting[] = "bootstrap: mounted filesystems; exec Bun 1.4.2\n";
    syscall6(1, 2, (long)starting, sizeof(starting) - 1, 0, 0, 0);

    syscall6(59, (long)bun, (long)argv, (long)envp, 0, 0, 0);

    static const char error[] = "init: execve(/bin/bun) failed\n";
    syscall6(1, 2, (long)error, sizeof(error) - 1, 0, 0, 0);
    for (;;)
        syscall6(34, 0, 0, 0, 0, 0, 0);
}
