# E-Rechnungs-Validator (Mustang, Apache-2.0) als kleiner HTTP-Dienst
ARG MUSTANG_VERSION=2.26.0

FROM eclipse-temurin:21-jdk AS build
ARG MUSTANG_VERSION
WORKDIR /app
ADD https://repo1.maven.org/maven2/org/mustangproject/Mustang-CLI/${MUSTANG_VERSION}/Mustang-CLI-${MUSTANG_VERSION}.jar /app/mustang.jar
COPY Server.java /app/Server.java
# Vorab kompilieren: die JRE im Laufzeit-Image enthält keinen Compiler für den Quelltext-Start
RUN javac -cp /app/mustang.jar -d /app/classes /app/Server.java

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/mustang.jar /app/mustang.jar
COPY --from=build /app/classes /app/classes
RUN useradd --system validator
USER validator
EXPOSE 8080
# Kein curl/wget im Image: Health-Anfrage über /dev/tcp der Bash
HEALTHCHECK --interval=30s --timeout=5s CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 && printf 'GET /health HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q ok <&3"]
CMD ["java", "-Xmx768m", "-cp", "/app/mustang.jar:/app/classes", "Server"]
