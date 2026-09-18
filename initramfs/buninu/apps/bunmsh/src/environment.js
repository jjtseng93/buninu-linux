export function environmentValue(env, name, platform = process.platform) {
  if (Object.hasOwn(env, name)) return env[name];
  if (platform !== "win32") return undefined;
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

export function canonicalEnvironment(env, platform = process.platform) {
  const output = { ...env };
  if (platform !== "win32") return output;
  const canonicalize = (name) => {
    const keys = Object.keys(output).filter((key) => key.toLowerCase() === name.toLowerCase());
    if (!keys.length) return undefined;
    const value = output[keys.at(-1)];
    for (const key of keys) delete output[key];
    output[name] = value;
    return value;
  };
  if (canonicalize("PATH") === undefined) delete output.PATH;
  let home = canonicalize("HOME");
  if (!home) {
    home = environmentValue(output, "USERPROFILE", platform);
    if (!home) {
      const drive = environmentValue(output, "HOMEDRIVE", platform) ?? "";
      const path = environmentValue(output, "HOMEPATH", platform) ?? "";
      home = drive && path ? `${drive}${path}` : "";
    }
  }
  if (home) {
    output.HOME = String(home).replaceAll("\\", "/");
  } else {
    delete output.HOME;
  }
  return output;
}

export function homeRelativePath(cwd, home, platform = process.platform) {
  if (!home) return null;
  const trim = (value) => {
    const normalized = String(value).replaceAll("\\", "/");
    return normalized === "/" ? "/" : normalized.replace(/\/+$/, "");
  };
  // Android exposes app data through both /data/data/PACKAGE and
  // /data/user/0/PACKAGE. They are the same app sandbox but string comparison
  // alone cannot recognise HOME when the two spellings are mixed.
  const comparable = (value) => trim(value).replace(
    /^\/data\/user\/0\/([^/]+)(?=\/|$)/,
    "/data/data/$1",
  );
  let comparedCwd = comparable(cwd);
  let comparedHome = comparable(home);
  if (platform === "win32") {
    comparedCwd = comparedCwd.toLowerCase();
    comparedHome = comparedHome.toLowerCase();
  }
  if (comparedCwd === comparedHome) return "";
  if (comparedHome === "/" && comparedCwd.startsWith("/")) return comparedCwd;
  return comparedCwd.startsWith(`${comparedHome}/`)
    ? comparable(cwd).slice(comparedHome.length)
    : null;
}
