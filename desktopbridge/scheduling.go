package desktopbridge

import "slices"

// Observation lanes never authorize a business write. Methods that can advance
// recovery or refresh/reconcile an account deliberately remain business work.
func observationLane(req request) string {
	switch req.Method {
	case "ping", "account_defaults", "authorize_open", "device_context", "device_recovery_snapshot", "runtime_snapshot", "network_status", "network_test", "authorize_status", "authorize_progress", "authorize_cancel", "diagnostics_snapshot", "diagnostics_cancel":
		return "observe:" + req.Method
	case "account_snapshot":
		if !req.Refresh {
			return "observe:account:" + req.Platform
		}
	}
	return ""
}
func platformLane(req request) string {
	switch req.Method {
	case "account_detect", "account_snapshot", "account_action", "supply_status", "supply_set_paused", "authorize_start":
		if req.Platform == "openai" || req.Platform == "claude" {
			return req.Platform
		}
	}
	return ""
}
func queuedRead(req request) bool {
	return req.Method == "account_detect" || req.Method == "account_snapshot" || req.Method == "supply_status"
}

func scheduledMethod(req request) bool {
	return observationLane(req) != "" || platformLane(req) != "" || slices.Contains(runtimeMethods, req.Method) || slices.Contains(authorizeMethods, req.Method) || slices.Contains(diagnosticMethods, req.Method) || slices.Contains(networkMethods, req.Method) || slices.Contains(notificationMethods, req.Method) || slices.Contains([]string{"device_status", "device_begin", "device_recovery_start", "device_recovery_prepare", "device_recovery_confirm", "device_recovery_status", "runtime_inspect_recovery", "runtime_reconcile_recovery", "runtime_verify", "desktop_switch"}, req.Method)
}
