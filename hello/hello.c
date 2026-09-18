typedef unsigned long long UINTN;
typedef unsigned short CHAR16;
typedef void *EFI_HANDLE;
typedef void *EFI_EVENT;
typedef UINTN EFI_STATUS;

#define EFIAPI __attribute__((ms_abi))

typedef struct EFI_SIMPLE_TEXT_OUTPUT_PROTOCOL EFI_SIMPLE_TEXT_OUTPUT_PROTOCOL;
typedef struct EFI_SIMPLE_TEXT_INPUT_PROTOCOL EFI_SIMPLE_TEXT_INPUT_PROTOCOL;
typedef EFI_STATUS(EFIAPI *EFI_TEXT_STRING)(EFI_SIMPLE_TEXT_OUTPUT_PROTOCOL *, CHAR16 *);

typedef struct {
    unsigned short ScanCode;
    CHAR16 UnicodeChar;
} EFI_INPUT_KEY;

typedef EFI_STATUS(EFIAPI *EFI_INPUT_READ_KEY)(EFI_SIMPLE_TEXT_INPUT_PROTOCOL *,
                                               EFI_INPUT_KEY *);

struct EFI_SIMPLE_TEXT_INPUT_PROTOCOL {
    void *Reset;
    EFI_INPUT_READ_KEY ReadKeyStroke;
    EFI_EVENT WaitForKey;
};

struct EFI_SIMPLE_TEXT_OUTPUT_PROTOCOL {
    void *Reset;
    EFI_TEXT_STRING OutputString;
};

typedef struct {
    char _pad[48];
    EFI_SIMPLE_TEXT_INPUT_PROTOCOL *ConIn;
    EFI_HANDLE ConsoleOutHandle;
    EFI_SIMPLE_TEXT_OUTPUT_PROTOCOL *ConOut;
} EFI_SYSTEM_TABLE;

EFI_STATUS EFIAPI efi_main(EFI_HANDLE image, EFI_SYSTEM_TABLE *system_table) {
    (void)image;
    system_table->ConOut->OutputString(system_table->ConOut,
        L"\r\nHello world from x64 UEFI!\r\n"
        L"Press any key to exit to UEFI firmware...\r\n");

    EFI_INPUT_KEY key;
    while (system_table->ConIn->ReadKeyStroke(system_table->ConIn, &key) != 0)
        __asm__ volatile("pause");

    return 0;
}
