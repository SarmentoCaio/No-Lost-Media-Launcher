#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    no_lost_media_launcher_lib::run();
}
