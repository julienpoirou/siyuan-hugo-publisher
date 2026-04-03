import { readDir, toWorkspacePath } from "./api";

/**
 * Opens a modal directory picker rooted in the SiYuan workspace.
 *
 * The user can navigate the workspace file tree and confirm a folder.
 * Only directories are shown. Navigating up past the workspace root is
 * prevented.
 *
 * @param initialPath Starting path (workspace-relative, e.g. `/data/hugo-site`).
 * @param onSelect    Called with the confirmed workspace-relative path.
 */
export function openPathExplorer(initialPath: string, onSelect: (path: string) => void): void {
  const startPath = toWorkspacePath(initialPath || "/data");
  let currentPath = startPath;

  const backdrop = document.createElement("div");
  Object.assign(backdrop.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,.45)",
    zIndex: "9999",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });

  const dialog = document.createElement("div");
  Object.assign(dialog.style, {
    width: "480px",
    maxHeight: "65vh",
    display: "flex",
    flexDirection: "column",
    borderRadius: "8px",
    overflow: "hidden",
    background: "var(--b3-theme-background)",
    boxShadow: "var(--b3-point-shadow)",
  });
  dialog.addEventListener("click", (e) => e.stopPropagation());

  const header = document.createElement("div");
  Object.assign(header.style, {
    padding: "14px 16px",
    fontWeight: "600",
    fontSize: "15px",
    borderBottom: "1px solid var(--b3-border-color)",
    flexShrink: "0",
  });
  header.textContent = "Select Hugo project folder";

  const breadcrumb = document.createElement("div");
  Object.assign(breadcrumb.style, {
    padding: "7px 16px",
    fontSize: "12px",
    fontFamily: "var(--b3-font-family-code)",
    color: "var(--b3-theme-on-surface-light)",
    background: "var(--b3-theme-surface)",
    borderBottom: "1px solid var(--b3-border-color)",
    wordBreak: "break-all",
    flexShrink: "0",
  });

  const list = document.createElement("div");
  Object.assign(list.style, {
    flex: "1",
    overflowY: "auto",
    minHeight: "180px",
    padding: "4px 0",
  });

  const footer = document.createElement("div");
  Object.assign(footer.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    padding: "12px 16px",
    borderTop: "1px solid var(--b3-border-color)",
    flexShrink: "0",
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "b3-button b3-button--cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", close);

  const selectBtn = document.createElement("button");
  selectBtn.className = "b3-button b3-button--text";
  selectBtn.textContent = "Select this folder";
  selectBtn.addEventListener("click", () => {
    onSelect(currentPath);
    close();
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(selectBtn);

  dialog.appendChild(header);
  dialog.appendChild(breadcrumb);
  dialog.appendChild(list);
  dialog.appendChild(footer);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  function close(): void {
    backdrop.remove();
  }
  backdrop.addEventListener("click", close);

  async function navigate(path: string): Promise<void> {
    currentPath = path;
    breadcrumb.textContent = path || "/";
    list.innerHTML = "";

    const spinner = document.createElement("div");
    Object.assign(spinner.style, { padding: "20px", textAlign: "center", color: "var(--b3-theme-on-surface-light)" });
    spinner.textContent = "Loading…";
    list.appendChild(spinner);

    const entries = await readDir(toWorkspacePath(path));
    list.innerHTML = "";

    const dirs = entries
      .filter((e) => e.isDir)
      .sort((a, b) => a.name.localeCompare(b.name));

    const parts = path.split("/").filter(Boolean);
    if (parts.length > 0) {
      const parentPath = "/" + parts.slice(0, -1).join("/");
      list.appendChild(createRow("↑  ..", parentPath.replace(/^$/, "/"), true));
    }

    if (dirs.length === 0) {
      const empty = document.createElement("div");
      Object.assign(empty.style, {
        padding: "20px",
        textAlign: "center",
        fontSize: "13px",
        color: "var(--b3-theme-on-surface-light)",
      });
      empty.textContent = "No subdirectories";
      list.appendChild(empty);
      return;
    }

    for (const dir of dirs) {
      const childPath = `${path}/${dir.name}`.replace(/\/+/g, "/");
      list.appendChild(createRow(dir.name, childPath, false));
    }
  }

  function createRow(label: string, targetPath: string, isUp: boolean): HTMLElement {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "8px 16px",
      cursor: "pointer",
      userSelect: "none",
    });
    row.addEventListener("mouseenter", () => { row.style.background = "var(--b3-list-hover)"; });
    row.addEventListener("mouseleave", () => { row.style.background = ""; });
    row.addEventListener("click", () => { void navigate(targetPath); });

    const icon = document.createElement("span");
    icon.textContent = isUp ? "⬆" : "📁";
    Object.assign(icon.style, { fontSize: "15px", flexShrink: "0", lineHeight: "1" });

    const name = document.createElement("span");
    name.textContent = label;
    Object.assign(name.style, {
      flex: "1",
      fontSize: "14px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });

    row.appendChild(icon);
    row.appendChild(name);
    return row;
  }

  void navigate(startPath);
}
