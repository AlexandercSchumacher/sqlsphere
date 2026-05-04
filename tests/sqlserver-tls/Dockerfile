FROM mcr.microsoft.com/mssql/server:2022-latest

USER root

RUN mkdir -p /var/opt/mssql/certs

COPY certs/sqlserver/ca.pem /var/opt/mssql/certs/ca.pem
COPY certs/sqlserver/server-cert.pem /var/opt/mssql/certs/server-cert.pem
COPY certs/sqlserver/server-key.pem /var/opt/mssql/certs/server-key.pem
COPY sqlserver-tls/mssql.conf /var/opt/mssql/mssql.conf

RUN chown -R 10001:0 /var/opt/mssql/certs /var/opt/mssql/mssql.conf \
    && chmod 644 /var/opt/mssql/certs/ca.pem /var/opt/mssql/certs/server-cert.pem \
    && chmod 600 /var/opt/mssql/certs/server-key.pem

USER 10001
