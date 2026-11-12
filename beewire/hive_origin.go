package beewire

import (
	"fmt"
	"net"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// CanonicalHiveOrigin returns a lookup key for a new Hive binding. Callers must
// retain historical raw origins and proofs separately; this does not identify
// servers behind different names, Unicode encodings, or IPv6 spellings.
func CanonicalHiveOrigin(input string) (string, error) {
	reject := func(check string) (string, error) {
		return "", fmt.Errorf("Hive origin rejected: %s; input_bytes=%d; credentials and raw input omitted", check, len(input))
	}
	if len(input) == 0 || len(input) > 2048 || !utf8.ValidString(input) {
		return reject("length or UTF-8 check failed; required=1..2048 UTF-8 bytes")
	}
	if strings.ContainsAny(input, "@?#\\%") || strings.IndexFunc(input, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0 {
		return reject("forbidden delimiter or whitespace present")
	}
	scheme, authority, ok := strings.Cut(input, "://")
	scheme = strings.ToLower(scheme)
	if !ok || scheme != "https" && scheme != "http" {
		return reject("scheme check failed; required=HTTPS or loopback HTTP")
	}
	authority = strings.TrimSuffix(authority, "/")
	if authority == "" || strings.Contains(authority, "/") {
		return reject("authority or root path check failed")
	}
	host, port := authority, ""
	if strings.HasPrefix(host, "[") {
		end := strings.IndexByte(host, ']')
		if end < 0 {
			return reject("IPv6 closing bracket missing")
		}
		suffix := host[end+1:]
		if suffix != "" {
			if !strings.HasPrefix(suffix, ":") || len(suffix) == 1 {
				return reject("IPv6 port check failed")
			}
			port = suffix[1:]
		}
		host = host[:end+1]
		if ip := net.ParseIP(host[1 : len(host)-1]); ip == nil || !strings.Contains(host, ":") {
			return reject("IPv6 literal check failed")
		}
	} else {
		if strings.Contains(host, ":") {
			host, port, ok = strings.Cut(host, ":")
			if !ok || port == "" {
				return reject("explicit port missing")
			}
		}
		if host == "" || strings.IndexFunc(host, func(r rune) bool {
			return !(unicode.IsLetter(r) || unicode.IsDigit(r) || strings.ContainsRune("-._", r))
		}) >= 0 {
			return reject("hostname character check failed")
		}
	}
	if port != "" {
		if strings.IndexFunc(port, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
			return reject("port is not decimal")
		}
		number, err := strconv.Atoi(port)
		if err != nil || number < 1 || number > 65535 {
			return reject("port outside 1..65535")
		}
		port = strconv.Itoa(number)
		if scheme == "https" && port == "443" || scheme == "http" && port == "80" {
			port = ""
		}
	}
	host = strings.ToLower(host)
	if scheme == "http" && host != "localhost" {
		ip := net.ParseIP(strings.Trim(host, "[]"))
		if ip == nil || !ip.IsLoopback() {
			return reject("HTTP host is not a standard loopback address")
		}
	}
	if port != "" {
		host += ":" + port
	}
	return scheme + "://" + host, nil
}
