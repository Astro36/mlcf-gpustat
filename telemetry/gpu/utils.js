export const normalizeGpuName = (name) => {
  if (name.includes("A4000")) return "NVIDIA RTX A4000";
  if (name.includes("A100")) return "NVIDIA A100 80GB";
  if (name.includes("2080")) return "GeForce RTX 2080 Ti";
  if (name.includes("3090")) return "GeForce RTX 3090";
  return name;
};
