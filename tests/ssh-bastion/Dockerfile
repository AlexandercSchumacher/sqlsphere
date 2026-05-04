FROM alpine:3.20

RUN apk add --no-cache openssh-server

RUN adduser -D -s /bin/sh sqlsphere \
    && echo "sqlsphere:sqlsphere_ssh_pass" | chpasswd

RUN mkdir -p /var/run/sshd /home/sqlsphere/.ssh \
    && chown -R sqlsphere:sqlsphere /home/sqlsphere/.ssh \
    && ssh-keygen -A

RUN cat >/etc/ssh/sshd_config <<'EOF'
Port 2222
Protocol 2
HostKey /etc/ssh/ssh_host_rsa_key
HostKey /etc/ssh/ssh_host_ecdsa_key
HostKey /etc/ssh/ssh_host_ed25519_key
PermitRootLogin no
PasswordAuthentication yes
PubkeyAuthentication yes
AllowTcpForwarding yes
GatewayPorts yes
PermitTunnel yes
UsePAM no
X11Forwarding no
ClientAliveInterval 30
ClientAliveCountMax 3
Subsystem sftp /usr/lib/ssh/sftp-server
EOF

EXPOSE 2222

CMD ["/usr/sbin/sshd", "-D", "-e"]
