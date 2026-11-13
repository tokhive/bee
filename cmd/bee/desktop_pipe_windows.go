package main

import "os"

func prepareDesktopPipe(file *os.File) (*os.File, error) {
	// Go's Windows pipe Close uses CancelIoEx for pending pipe I/O. Native
	// verification remains required; Unix descriptor flags do not apply here.
	return file, nil
}
