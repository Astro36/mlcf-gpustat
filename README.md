# MLCF GPUstat

[![Node.js Version](https://img.shields.io/badge/node-23+-5FA04E?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![GitHub License](https://img.shields.io/github/license/Astro36/mlcf-gpustat?style=for-the-badge&logo=opensourceinitiative&logoColor=white&color=3DA639)](https://github.com/Astro36/mlcf-gpustat/blob/main/LICENSE)
[![Docker](https://img.shields.io/badge/docker%20compose-supported-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

MLCF GPUstat is a lightweight, **web-based monitoring tool** for tracking GPU usage across multiple servers in real time.
It connects to remote servers via SSH and uses the `nvidia-smi` command to collect detailed metrics such as GPU utilization, memory usage, and active processes.
The tool is designed to support efficient workload scheduling and resource monitoring in multi-user environments.

## Key Features

- Real-time monitoring of GPU status across multiple servers
- Display of GPU utilization and memory consumption
- User-specific GPU memory usage tracking
- Real-time data updates via WebSockets
- Responsive web interface

## Installation and Setup

### Prerequisites

- Node.js 23 or higher
- SSH access to servers you want to monitor
- NVIDIA GPUs and `nvidia-smi` tool on target servers
- Docker and Docker Compose (optional)

### Installation

1. Clone the repository:

    ```sh
    git clone https://github.com/Astro36/mlcf-gpustat.git
    cd mlcf-gpustat
    ```

1. Install dependencies:

    ```sh
    npm install
    cd static && npm install && cd ..
    ```

1. Create the server configuration file (`servers.config.json`) with your server details:

    ```json
    [
        {
            "name": "Server-1",
            "host": "server1.example.com",
            "username": "your-username",
            "password": "your-password"
        },
        {
            "name": "Server-2",
            "host": "server2.example.com",
            "username": "your-username",
            "password": "your-password"
        }
    ]
    ```

### Running the Application

#### Running Locally

1. Build the frontend:

    ```sh
    cd static && npm run build && cd ..
    ```

1. Start the server:

    ```sh
    node main.js
    ```

1. Access the application at `http://localhost:3000`

#### Running with Docker

1. Build the Docker image:

    ```sh
    docker build -t gpustat .
    ```

1. Run using Docker Compose:

    ```sh
    docker-compose up -d
    ```

1. Access the application at `http://localhost:3000`

## License

Distributed under the MIT License. See [LICENSE](./LICENSE) file for more information.

## About MLCF

The Multimodal Learning and Computational Finance (MLCF) Laboratory at Yonsei University conducts research that bridges machine learning and real-world applications.
The lab applies these methodologies to domains such as financial AI, sign language translation, autonomous driving, and 3D vision.
This tool was developed to better manage the lab's computational resources for research projects.

## Developer

Seungjae Park (M.S. student, <seungjae.park@yonsei.ac.kr>)
