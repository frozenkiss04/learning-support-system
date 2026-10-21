from flask import jsonify


def ok(data=None, status=200, **meta):
    body = {"success": True, "data": data}
    body.update(meta)
    return jsonify(body), status


def fail(message, status=400, code=None):
    return jsonify({"success": False, "error": {"message": message, "code": code or status}}), status
