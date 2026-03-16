#!/bin/sh
jq '[.records[] | select(.Type | contains(["Conference"])) | {name: .Name, deadline: ."Applications/registrations close", link: ."Link".url}]' aisafety_events.json
