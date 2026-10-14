#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static int initialized;
__attribute__((constructor)) static void init(void) { initialized = 37; }
__attribute__((destructor)) static void fini(void) { puts("destructor OK"); }
int main(int argc, char **argv) {
    if (initialized != 37) return 1;
    if (argc != 3 || strcmp(argv[1], "hello") || strcmp(argv[2], "two words")) return 2;
    const char *value = getenv("CRT_TEST");
    if (!value || strcmp(value,"seed-free")) return 3;
    puts("argc/argv, environment, constructor OK");
    return 42;
}
