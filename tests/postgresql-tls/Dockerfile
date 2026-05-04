FROM postgres:15

RUN mkdir -p /etc/postgresql/certs

COPY certs/ca/ca.pem /etc/postgresql/certs/ca.pem
COPY certs/postgresql/server-cert.pem /etc/postgresql/certs/server-cert.pem
COPY certs/postgresql/server-key.pem /etc/postgresql/certs/server-key.pem

RUN chown postgres:postgres /etc/postgresql/certs/ca.pem /etc/postgresql/certs/server-cert.pem /etc/postgresql/certs/server-key.pem \
    && chmod 644 /etc/postgresql/certs/ca.pem /etc/postgresql/certs/server-cert.pem \
    && chmod 600 /etc/postgresql/certs/server-key.pem
