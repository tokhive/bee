// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

#[cfg(feature = "semver")]
use crate::semver_compat::semver_compat_string;

use super::SingleInstanceCallback;
use tauri::{
    plugin::{self, TauriPlugin},
    AppHandle, Manager, Runtime,
};
use zbus::{blocking::Connection, interface, names::WellKnownName};

#[path = "startup_lock.rs"]
mod startup_lock;

struct ConnectionHandle {
    connection: Connection,
    // A restarted bus must not elect another management parent while this one
    // still owns a Child. Keep the lease even when the bus disconnects.
    _lease: std::fs::File,
}

struct SingleInstanceDBus<R: Runtime> {
    callback: Box<SingleInstanceCallback<R>>,
    app_handle: AppHandle<R>,
}

#[interface(name = "org.SingleInstance.DBus")]
impl<R: Runtime> SingleInstanceDBus<R> {
    fn execute_callback(&mut self, argv: Vec<String>, cwd: String) {
        (self.callback)(&self.app_handle, argv, cwd);
    }
}

struct DBusName(String);

pub fn init<R: Runtime>(
    callback: Box<SingleInstanceCallback<R>>,
    dbus_id: Option<String>,
) -> TauriPlugin<R> {
    plugin::Builder::new("single-instance")
        .setup(move |app, _api| {
            let mut dbus_name = dbus_id.unwrap_or_else(|| app.config().identifier.clone());
            dbus_name.push_str(".SingleInstance");

            #[cfg(feature = "semver")]
            {
                dbus_name.push('_');
                dbus_name.push_str(semver_compat_string(&app.package_info().version).as_str());
            }

            let mut dbus_path = dbus_name.replace('.', "/").replace('-', "_");
            if !dbus_path.starts_with('/') {
                dbus_path = format!("/{dbus_path}");
            }

            let single_instance_dbus = SingleInstanceDBus {
                callback,
                app_handle: app.clone(),
            };

            let builder = zbus::blocking::connection::Builder::session().map_err(|cause| {
                std::io::Error::other(format!("create single-instance D-Bus session builder failed: {cause}; registration stopped before app setup"))
            })?;

            match builder
                .name(dbus_name.as_str()).map_err(|cause| {
                    std::io::Error::other(format!("configure single-instance D-Bus name={dbus_name}: {cause}"))
                })?
                .replace_existing_names(false)
                .allow_name_replacements(false)
                .build()
            {
                Ok(connection) => {
                    // dbus_name was validated by Builder::name above. Do not
                    // expose a callback until this process holds the lifetime
                    // lease; an older primary may still be alive on a dead bus.
                    let lease_path = std::path::PathBuf::from(format!(
                        "/tmp/bee-{}-{}_primary.lock", unsafe { libc::geteuid() }, dbus_name.replace(['.', '-'], "_")
                    ));
                    let lease = startup_lock::lock_registration(&lease_path)?;
                    let added = connection.object_server().at(dbus_path.as_str(), single_instance_dbus)
                        .map_err(|cause| std::io::Error::other(format!(
                            "serve single-instance D-Bus path={dbus_path} after lifetime lease: {cause}"
                        )))?;
                    if !added {
                        return Err(std::io::Error::other(format!(
                            "single-instance D-Bus interface registration path={dbus_path} returned false; required=new callback interface before app setup"
                        )).into());
                    }
                    app.manage(ConnectionHandle { connection, _lease: lease });
                }
                Err(zbus::Error::NameTaken) => {
                    let connection = Connection::session().map_err(|cause| {
                        std::io::Error::other(format!("connect to existing single-instance D-Bus session failed: {cause}"))
                    })?;
                    connection
                        .call_method(
                            Some(dbus_name.as_str()),
                            dbus_path.as_str(),
                            Some("org.SingleInstance.DBus"),
                            "ExecuteCallback",
                            &(
                                std::env::args_os()
                                    .map(|arg| arg.to_string_lossy().into_owned())
                                    .collect::<Vec<String>>(),
                                std::env::current_dir()
                                    .unwrap_or_default()
                                    .to_string_lossy()
                                    .as_ref(),
                            ),
                        )
                        .map_err(|error| {
                            format!("forward single-instance D-Bus request failed: {error}; primary acceptance was not confirmed")
                        })?;
                    // Exit successfully only after the primary accepted the arguments.
                    app.cleanup_before_exit();
                    std::process::exit(0);
                }
                Err(error) => {
                    return Err(std::io::Error::other(format!(
                        "register single-instance D-Bus service failed: {error}; required=exclusive session bus name before app setup"
                    )).into());
                }
            }

            app.manage(DBusName(dbus_name));

            Ok(())
        })
        .build()
}

pub fn destroy<R: Runtime, M: Manager<R>>(manager: &M) {
    if let Some(connection) = manager.try_state::<ConnectionHandle>() {
        if let Some(dbus_name) = manager
            .try_state::<DBusName>()
            .and_then(|name| WellKnownName::try_from(name.0.clone()).ok())
        {
            let _ = connection.connection.release_name(dbus_name);
        }
    }
}
