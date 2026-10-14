#include "/bootstrap/src/tinycc/libtcc.c"

int compile_object(const char *source, const char *output, const char *flags) {
    TCCState *s = tcc_new();
    if (!s) return 10;
    tcc_set_lib_path(s, "/bootstrap/src/tinycc");
    int result = tcc_set_options(s, flags);
    if (!result) result = tcc_set_output_type(s, TCC_OUTPUT_OBJ);
    if (!result) result = tcc_add_file(s, source);
    if (!result) result = tcc_output_file(s, output);
    tcc_delete(s);
    return result;
}
#include "/bootstrap/src/tinycc/bun-x64-runtime.c"
