#!/bin/bash

# use this to clear the DLQ between tests
redis-cli -h redis DEL ticket-purchase-dlq
