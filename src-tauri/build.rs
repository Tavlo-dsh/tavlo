fn main() {
    // Windows exe 图标由构建脚本编译；换图时也必须重建资源，避免复用旧图标。
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build();
}
