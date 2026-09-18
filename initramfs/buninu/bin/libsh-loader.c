#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static char *append_script_suffix(const char *path) {
    size_t path_len = strlen(path);
    char *script_path = malloc(path_len + sizeof(".sh"));

    if (!script_path) {
        return NULL;
    }

    memcpy(script_path, path, path_len);
    memcpy(script_path + path_len, ".sh", sizeof(".sh"));
    return script_path;
}

static char *multicall_path_for(const char *script_path) {
    const char *slash = strrchr(script_path, '/');
    size_t directory_len = slash ? (size_t)(slash - script_path + 1) : 0;
    char *multicall_path = malloc(directory_len + sizeof("multicall.sh"));

    if (!multicall_path) {
        return NULL;
    }

    memcpy(multicall_path, script_path, directory_len);
    memcpy(multicall_path + directory_len,
           "multicall.sh", sizeof("multicall.sh"));
    return multicall_path;
}

static char *find_script_path(const char *invoked_as) {
    if (!invoked_as || !*invoked_as) {
        return NULL;
    }

    /* Relative and absolute paths are used exactly as supplied. */
    if (strchr(invoked_as, '/')) {
        return append_script_suffix(invoked_as);
    }

    const char *path = getenv("PATH");
    if (!path) {
        return NULL;
    }

    size_t name_len = strlen(invoked_as);
    const char *entry = path;

    for (;;) {
        const char *separator = strchr(entry, ':');
        size_t entry_len = separator ? (size_t)(separator - entry) : strlen(entry);
        const char *directory = entry_len ? entry : ".";
        size_t directory_len = entry_len ? entry_len : 1;
        int needs_slash = directory[directory_len - 1] != '/';
        size_t executable_len = directory_len + needs_slash + name_len;
        char *executable_path = malloc(executable_len + 1);

        if (!executable_path) {
            return NULL;
        }

        memcpy(executable_path, directory, directory_len);
        if (needs_slash) {
            executable_path[directory_len] = '/';
        }
        memcpy(executable_path + directory_len + needs_slash,
               invoked_as, name_len + 1);

        if (access(executable_path, X_OK) == 0) {
            char *script_path = append_script_suffix(executable_path);
            free(executable_path);
            return script_path;
        }

        free(executable_path);
        if (!separator) {
            break;
        }
        entry = separator + 1;
    }

    return NULL;
}

int main(int argc, char *argv[]) {
    char *path = find_script_path(argv[0]);
    if (!path) {
        fprintf(stderr, "Cannot locate loader in PATH: %s\n",
                argv[0] ? argv[0] : "(null)");
        return 127;
    }

    if (access(path, F_OK) != 0) {
        char *companion_path = path;
        path = multicall_path_for(companion_path);

        if (!path || access(path, F_OK) != 0) {
            fprintf(stderr,
                    "Companion scripts not found: %s or %s\n",
                    companion_path,
                    path ? path : "multicall.sh");
            free(path);
            free(companion_path);
            return 127;
        }

        free(companion_path);
    }

    // new argv: ["sh", script, argv[1], ..., NULL]
    char **new_argv = malloc(sizeof(char *) * (argc + 2));
    if (!new_argv) {
        free(path);
        return 1;
    }

    new_argv[0] = argv[0];
    new_argv[1] = path;

    for (int i = 1; i < argc; i++) {
        new_argv[i + 1] = argv[i];
    }

    new_argv[argc + 1] = NULL;

    execv("/system/bin/sh", new_argv);

    perror("/system/bin/sh");
    free(new_argv);
    free(path);
    return 127;
}
