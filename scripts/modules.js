// The kernel modules the initramfs ships, as fetch-alpine.sh picks them: each
// requested by name, with what the package's modules.dep says it needs. The
// image gets a modules.dep trimmed to the shipped set, the fs-* lines and
// the device ids of the shipped modules from modules.alias, and the
// package's modules.builtin; /lib/modprobe.js reads those three files.
//
// fetch.js uses select(), trimDependencies() and filterAliases().

// Network: virtio-net for QEMU (init.js loads these at boot). virtio_pci is
// the PCI transport for every virtio device; linux-virt builds it in,
// linux-lts has it as a module that nothing in modules.dep pulls in.
// Storage: what /bin/mount loads on demand. Pointing devices for
// `bunterm --mouse`. The framebuffer for bunterm on lts. Sound for QEMU's and
// PCs' usual devices. --real adds the USB keyboard, PC storage and ACPI
// drivers, and the wired and USB network drivers.
const required = (names) => names.map((name) => ({ name }));
const optional = (names) => names.map((name) => ({ name, optional: true }));

export const requests = ({ arch, flavor, real }) => [
  ...required([
    "failover",
    "net_failover",
    "virtio_net",
  ]),
  ...optional([
    "virtio_pci",
  ]),
  ...required([
    "virtio_blk",
    "ext4",
    "vfat",
    "exfat",
    "ntfs3",
    "nls_utf8",
    "nls_cp437",
    "nls_iso8859-1",
  ]),
  ...optional([
    "ext2",
  ]),
  ...required([
    "evdev",
    arch === "x86_64" ? "psmouse" : "virtio_input",
  ]),
  ...(flavor === "lts" ? optional([
    "simpledrm",
  ]) : []),
  ...optional([
    "snd-ens1371",
    "snd-hda-intel",
    "snd-hda-codec-generic",
    "snd-hda-codec-hdmi",
    "snd-usb-audio",
  ]),
  ...(real ? required([
    // USB keyboard
    "usb-common",
    "usbcore",
    "xhci-hcd",
    "xhci-pci",
    "xhci-pci-renesas",
    "hid",
    "hid-generic",
    "usbhid",
    // SATA/AHCI, PATA, NVMe (with Intel VMD), USB mass storage and UAS
    "sd_mod",
    "ahci",
    "ata_generic",
    "pata_acpi",
    "nvme",
    "vmd",
    "usb-storage",
    "uas",
    // ACPI: battery, AC adapter, power button, thermal zones
    "battery",
    "ac",
    "button",
    "thermal",
    // Wired NICs: Intel, Realtek (with its PHY), Qualcomm Atheros, Broadcom
    "e1000",
    "e1000e",
    "igb",
    "igc",
    "r8169",
    "realtek",
    "alx",
    "tg3",
    // USB NICs and Android tethering (RNDIS, CDC ECM/NCM/EEM, subset, zaurus)
    "r8152",
    "ax88179_178a",
    "cdc_ether",
    "rndis_host",
    "cdc_ncm",
    "cdc_eem",
    "cdc_subset",
    "zaurus",
  ]) : []),
];

/**
 * The modules.dep paths (".ko.gz", relative to the release directory) to
 * ship, dependencies after the module that pulled them in, and notes about
 * optional modules the kernel neither builds in nor packages.
 */
export const select = ({ dep, builtin, packageName, ...target }) => {
  const lines = dep.split("\n");
  const builtinLines = builtin.split("\n");
  const selected = [];
  const seen = new Set();
  const notes = [];
  const find = (name) => lines.find((line) => line.includes(`/${name}.ko.gz:`));
  const add = (name) => {
    // An explicit stack instead of recursion; the order matches the shell's
    // depth-first walk.
    const stack = [name];
    while (stack.length) {
      const current = stack.pop();
      const line = find(current);
      if (!line) throw new Error(`module ${current} is not in ${packageName}`);
      const path = line.slice(0, line.indexOf(":"));
      if (seen.has(path)) continue;
      seen.add(path);
      selected.push(path);
      const dependencies = line.slice(line.indexOf(":") + 1).trim().split(/\s+/).filter(Boolean)
        .map((dependency) => dependency.slice(dependency.lastIndexOf("/") + 1).replace(/\.ko\.gz$/, ""));
      stack.push(...dependencies.reverse());
    }
  };
  for (const { name, optional } of requests(target)) {
    if (!optional || find(name)) add(name);
    else if (!builtinLines.some((line) => line.endsWith(`/${name}.ko`))) {
      notes.push(`note: module ${name} is not in ${target.arch} ${packageName}; skipped`);
    }
  }
  return { selected, notes };
};

/** modules.dep with only the shipped modules' lines, .ko.gz renamed .ko. */
export const trimDependencies = (dep, selected) => {
  const wanted = new Set(selected);
  return dep.split("\n")
    .filter((line) => line.includes(":") && wanted.has(line.slice(0, line.indexOf(":"))))
    .map((line) => `${line.replaceAll(".ko.gz", ".ko")}\n`)
    .join("");
};

/** modules.alias: the fs-* names, and the pci:/usb:/virtio: ids of shipped modules. */
export const filterAliases = (alias, selected) => {
  const shipped = new Set(selected.map((path) => path.slice(path.lastIndexOf("/") + 1).replace(/\.ko\.gz$/, "").replaceAll("-", "_")));
  return alias.split("\n")
    .filter((line) => {
      const fields = line.trim().split(/\s+/);
      if (/^fs-/.test(fields[1] ?? "")) return true;
      return /^(pci|usb|virtio):/.test(fields[1] ?? "") && shipped.has((fields[2] ?? "").replaceAll("-", "_"));
    })
    .map((line) => `${line}\n`)
    .join("");
};
