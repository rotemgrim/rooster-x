package server

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	mrand "math/rand"
	"net"
	"os"
	"path/filepath"
	"time"
)

// certDir returns the directory where the self-signed TLS cert and key live.
// We put them next to the executable so the cert survives across restarts
// and browsers only have to accept the "Not secure" warning once per device.
func certDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(filepath.Dir(exe), "certs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// ensureSelfSignedCert returns (certPath, keyPath) for a self-signed cert,
// generating a new pair only if one doesn't already exist on disk.
//
// The generated cert is valid for 10 years and includes as SANs:
//   - localhost
//   - 127.0.0.1, ::1
//   - every non-loopback IPv4 address currently bound on the host (LAN IPs)
//
// so the same cert works when you connect via `https://localhost:8443` on
// the PC and via `https://192.168.x.y:8443` from a phone on the LAN.
func ensureSelfSignedCert() (string, string, error) {
	dir, err := certDir()
	if err != nil {
		return "", "", fmt.Errorf("locate cert dir: %w", err)
	}
	certPath := filepath.Join(dir, "cert.pem")
	keyPath := filepath.Join(dir, "key.pem")

	if fileExists(certPath) && fileExists(keyPath) {
		return certPath, keyPath, nil
	}

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", fmt.Errorf("generate key: %w", err)
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		serial = big.NewInt(mrand.Int63())
	}

	notBefore := time.Now().Add(-1 * time.Hour)
	notAfter := notBefore.Add(10 * 365 * 24 * time.Hour) // ~10 years

	template := x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName:   "roosterx-selfsigned",
			Organization: []string{"RoosterX"},
		},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
		DNSNames:              []string{"localhost"},
		IPAddresses:           collectLocalIPs(),
	}

	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return "", "", fmt.Errorf("create certificate: %w", err)
	}

	// Write cert.
	certOut, err := os.Create(certPath)
	if err != nil {
		return "", "", fmt.Errorf("write cert: %w", err)
	}
	if err := pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: der}); err != nil {
		certOut.Close()
		return "", "", err
	}
	certOut.Close()

	// Write key.
	keyBytes, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		return "", "", fmt.Errorf("marshal key: %w", err)
	}
	keyOut, err := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return "", "", fmt.Errorf("write key: %w", err)
	}
	if err := pem.Encode(keyOut, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyBytes}); err != nil {
		keyOut.Close()
		return "", "", err
	}
	keyOut.Close()

	return certPath, keyPath, nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// collectLocalIPs returns every IPv4 / IPv6 address bound on this host so
// the self-signed cert is valid for whichever LAN IP the user types.
func collectLocalIPs() []net.IP {
	ips := []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback}

	ifaces, err := net.Interfaces()
	if err != nil {
		return ips
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 {
			continue
		}
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil {
				continue
			}
			// Skip link-local IPv6 and any nil/zero addresses.
			if ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
				continue
			}
			ips = append(ips, ip)
		}
	}
	return ips
}
