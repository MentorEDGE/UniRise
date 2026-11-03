# A session document whose target host and port are fixed. The standard AWS-StartPortForwardingSessionToRemoteHost document lets
# the caller choose any host and port the bastion can reach; developers are only allowed to use this one instead.
resource "aws_ssm_document" "db_tunnel" {
  name            = "${local.name}-db-tunnel"
  document_type   = "Session"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "1.0"
    description   = "Port forward to the UniRise dev database only"
    sessionType   = "Port"
    parameters = {
      localPortNumber = {
        type        = "String"
        description = "Port on your laptop"
        default     = "15432"
      }
    }
    properties = {
      type            = "LocalPortForwarding"
      host            = aws_db_instance.main.address
      portNumber      = "5432"
      localPortNumber = "{{ localPortNumber }}"
    }
  })
}
