# E-Rechnungs-Validator (Mustang, Apache-2.0) als kleiner HTTP-Dienst
FROM eclipse-temurin:21-jre
ARG MUSTANG_VERSION=2.26.0
WORKDIR /app
ADD https://repo1.maven.org/maven2/org/mustangproject/Mustang-CLI/${MUSTANG_VERSION}/Mustang-CLI-${MUSTANG_VERSION}.jar /app/mustang.jar
COPY Server.java /app/Server.java
RUN useradd --system validator && chown -R validator /app
USER validator
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["java", "-Xmx768m", "-cp", "/app/mustang.jar", "/app/Server.java"]
