class ApiResponse {

  constructor(status, data = {}, message = "Success") {

    this.status = status;
    this.success = status < 400;
    this.message = message;
    this.data = data;

  }

}

export {ApiResponse};